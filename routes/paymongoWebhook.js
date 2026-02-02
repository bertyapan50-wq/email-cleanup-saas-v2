const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Referral = require('../models/Referral');
const logger = require('../utils/logger');

/**
 * Verify PayMongo webhook signature
 */
function verifyWebhookSignature(payload, signature) {
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    logger.warn('⚠️ PAYMONGO_WEBHOOK_SECRET not set, skipping signature verification');
    return true; // Skip verification if no secret set (dev mode)
  }

  try {
    const computedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return computedSignature === signature;
  } catch (error) {
    logger.error('Error verifying webhook signature:', error);
    return false;
  }
}

/**
 * Activate referral when user subscribes
 */
async function activateUserReferral(userId) {
  try {
    const referral = await Referral.findOne({
      referredUserId: userId,
      status: 'pending'
    });

    if (!referral) {
      logger.info(`No pending referral for user ${userId}`);
      return;
    }

    referral.status = 'active';
    referral.subscribedAt = new Date();
    referral.rewardAmount = 2000; // ₱20
    await referral.save();

    const referrer = await User.findById(referral.referrerId);
    if (referrer) {
      // Check yearly limit (₱500/year = 50000 centavos)
      const currentYearCredits = await calculateYearlyCredits(referral.referrerId);
      const maxYearlyCredits = 50000; // ₱500
      const creditAmount = 2000; // ₱20

      if (currentYearCredits + creditAmount <= maxYearlyCredits) {
        referrer.totalReferralCredits = (referrer.totalReferralCredits || 0) + creditAmount;
        referrer.availableReferralCredits = (referrer.availableReferralCredits || 0) + creditAmount;
        await referrer.save();

        logger.info(`✅ Referral activated! User ${userId} subscribed. Referrer earned ₱20 credit.`);
      } else {
        logger.info(`⚠️ Referral activated but referrer reached max yearly credits (₱500)`);
      }
    }
  } catch (error) {
    logger.error('Error activating referral:', error);
  }
}

/**
 * Calculate yearly credits earned
 */
async function calculateYearlyCredits(userId) {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  
  const referrals = await Referral.find({
    referrerId: userId,
    status: 'active',
    subscribedAt: { $gte: startOfYear }
  });

  return referrals.reduce((total, ref) => total + (ref.rewardAmount || 0), 0);
}

/**
 * PayMongo Webhook Handler
 */
router.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const signature = req.headers['paymongo-signature'];
      const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      // Verify webhook signature
      if (!verifyWebhookSignature(event, signature)) {
        logger.error('❌ Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const eventType = event.data?.attributes?.type;
      logger.info(`📩 PayMongo webhook received: ${eventType}`);

      // Handle different event types
      switch (eventType) {
        case 'payment.paid':
          await handlePaymentPaid(event);
          break;
        
        case 'payment.failed':
          await handlePaymentFailed(event);
          break;
        
        case 'checkout.session.payment.paid':
          await handleCheckoutCompleted(event);
          break;
        
        default:
          logger.info(`Unhandled webhook event: ${eventType}`);
      }

      res.json({ success: true });
    } catch (err) {
      logger.error('❌ Webhook error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Handle successful payment
 */
async function handlePaymentPaid(event) {
  try {
    const payment = event.data.attributes.data;
    const metadata = payment.attributes.metadata;
    
    if (!metadata?.userId) {
      logger.warn('No userId in payment metadata');
      return;
    }

    const userId = metadata.userId;
    const tier = metadata.plan || 'pro';
    const billingCycle = metadata.billingCycle || 'monthly';

    logger.info(`💳 Payment received for user ${userId}, plan: ${tier}, cycle: ${billingCycle}`);

    const user = await User.findById(userId);
    if (!user) {
      logger.error(`User not found: ${userId}`);
      return;
    }

    // Skip if already upgraded
    if (user.subscriptionTier === tier && user.subscriptionStatus === 'active') {
      logger.info(`User ${userId} already has active ${tier} subscription`);
      return;
    }

    // Apply referral credits if available
    const availableCredits = user.availableReferralCredits || 0;
    const subscriptionPrice = billingCycle === 'annual' ? 383000 : 39900;
    
    if (availableCredits > 0) {
      const creditsUsed = Math.min(availableCredits, subscriptionPrice);
      user.availableReferralCredits -= creditsUsed;
      logger.info(`💰 Applied ${creditsUsed} credits for ${user.email}. Remaining: ${user.availableReferralCredits}`);
    }

    // Upgrade user
    user.subscriptionTier = tier;
    user.emailQuotaLimit = 999999;
    user.subscriptionStatus = 'active';

    // Calculate next billing date based on cycle
    const now = new Date();
    const nextBilling = new Date(now);
    
    if (billingCycle === 'annual') {
      nextBilling.setFullYear(nextBilling.getFullYear() + 1); // +1 year
    } else {
      nextBilling.setMonth(nextBilling.getMonth() + 1); // +1 month
    }

    user.nextBillingDate = nextBilling;
    user.currentPeriodEnd = nextBilling;

    await user.save();

    // Update or create subscription record
    let subscription = await Subscription.findOne({ userId });
    
    if (!subscription) {
      subscription = await Subscription.create({
        userId,
        plan: tier,
        provider: 'paymongo',
        status: 'active',
        amount: subscriptionPrice,
        currency: 'PHP',
        currentPeriodStart: now,
        currentPeriodEnd: nextBilling,
        nextBillingDate: nextBilling,
        paymongoSubscriptionId: payment.id,
        metadata: {
          billingCycle,
          paymentId: payment.id
        }
      });
    } else {
      subscription.status = 'active';
      subscription.plan = tier;
      subscription.amount = subscriptionPrice;
      subscription.currentPeriodStart = now;
      subscription.currentPeriodEnd = nextBilling;
      subscription.nextBillingDate = nextBilling;
      subscription.paymongoSubscriptionId = payment.id;
      subscription.metadata = {
        ...subscription.metadata,
        billingCycle,
        paymentId: payment.id
      };
      await subscription.save();
    }

    // Activate referral if user was referred
    await activateUserReferral(userId);

    logger.info(`✅ User upgraded to ${tier} (${billingCycle}): ${user.email}`);
    logger.info(`Next billing: ${nextBilling.toLocaleDateString()}`);
  } catch (error) {
    logger.error('Error handling payment.paid:', error);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(event) {
  try {
    const payment = event.data.attributes.data;
    const userId = payment.attributes.metadata?.userId;

    if (userId) {
      logger.error(`❌ Payment failed for user: ${userId}`);
      
      const user = await User.findById(userId);
      if (user) {
        user.subscriptionStatus = 'past_due';
        await user.save();
      }

      const subscription = await Subscription.findOne({ userId });
      if (subscription) {
        subscription.status = 'past_due';
        subscription.failedPaymentAttempts = (subscription.failedPaymentAttempts || 0) + 1;
        await subscription.save();
      }
    }
  } catch (error) {
    logger.error('Error handling payment.failed:', error);
  }
}

/**
 * Handle checkout session completed
 */
async function handleCheckoutCompleted(event) {
  try {
    const checkoutSession = event.data.attributes.data;
    const metadata = checkoutSession.attributes.metadata;
    
    if (!metadata?.userId) {
      logger.warn('No userId in checkout metadata');
      return;
    }

    logger.info(`✅ Checkout completed for user: ${metadata.userId}`);
    
    // Payment will be handled by payment.paid event
    // This is just for logging/tracking
  } catch (error) {
    logger.error('Error handling checkout.completed:', error);
  }
}

module.exports = router;