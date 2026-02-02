require('dotenv').config();

const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { protect } = require('../middleware/auth');
const axios = require('axios');
const User = require('../models/User');
const Referral = require('../models/Referral');
const logger = require('../utils/logger');

// =====================
// Original routes (UNTOUCHED)
// =====================
router.get('/', protect, subscriptionController.getSubscription);
router.post('/create', protect, subscriptionController.createSubscription);
router.post('/cancel', protect, subscriptionController.cancelSubscription);

// =====================
// PayMongo API Config
// =====================
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_BASE_URL = 'https://api.paymongo.com/v1';
const auth = Buffer.from(PAYMONGO_SECRET_KEY).toString('base64');

if (!PAYMONGO_SECRET_KEY) {
  throw new Error('PAYMONGO_SECRET_KEY is missing. Check .env file');
}

// ✅ Pricing Configuration (in centavos)
const PRICING = {
  pro: {
    monthly: 39900,   // ₱399/month
    annual: 383000    // ₱3,830/year (20% discount)
  }
};

// ✅ Activate referral when user subscribes
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

// ✅ Helper function to calculate credits earned this year
async function calculateYearlyCredits(userId) {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  
  const referrals = await Referral.find({
    referrerId: userId,
    status: 'active',
    subscribedAt: { $gte: startOfYear }
  });

  return referrals.reduce((total, ref) => total + (ref.rewardAmount || 0), 0);
}

// ✅ Helper for PayMongo requests
const paymongoRequest = async (method, endpoint, data = null) => {
  try {
    const response = await axios({
      method,
      url: `${PAYMONGO_BASE_URL}${endpoint}`,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      data
    });
    return response.data;
  } catch (error) {
    logger.error('PayMongo API Error:', error.response?.data || error.message);
    throw error;
  }
};

// =====================
// Subscription Status
// =====================
router.get('/status', protect, async (req, res) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      subscription: {
        tier: user.subscriptionTier || 'free',
        quotaUsed: user.emailQuotaUsed || 0,
        quotaLimit: user.emailQuotaLimit || 100,
        status: user.subscriptionStatus,
        currentPeriodEnd: user.currentPeriodEnd,
        nextBillingDate: user.nextBillingDate,
        isPremium: user.subscriptionTier === 'pro' || user.subscriptionTier === 'premium'
      }
    });
  } catch (error) {
    logger.error('Get subscription status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================
// Create PayMongo Checkout Session (UPDATED)
// =====================
router.post('/paymongo/create-checkout', protect, async (req, res) => {
  try {
    logger.info('🔍 Starting PayMongo checkout creation');
    
    const { tier = 'pro', billingCycle = 'monthly' } = req.body;

    // Validate inputs
    if (!['pro'].includes(tier)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tier. Must be "pro"'
      });
    }

    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid billing cycle. Must be "monthly" or "annual"'
      });
    }

    console.log('🔍 req.user:', JSON.stringify(req.user, null, 2));

    // Find user in DB
    let user = await User.findOne({ googleId: req.user.id });
    if (!user) {
      user = await User.findOne({ email: req.user.email });
    }

    // Create user if not found
    if (!user) {
      user = await User.create({
        googleId: req.user.id,
        email: req.user.email,
        name: req.user.name || 'No Name',
        subscriptionTier: 'free',
        emailQuotaLimit: 100
      });
      logger.info(`🆕 User created in DB: ${user.email}`);
    }

    // Get pricing
    const amount = PRICING[tier][billingCycle];

    // Apply referral credits
    const availableCredits = user.availableReferralCredits || 0;
    let finalAmount = amount;
    let creditsToApply = 0;

    if (availableCredits > 0) {
      creditsToApply = Math.min(availableCredits, amount);
      finalAmount = amount - creditsToApply;
      logger.info(`💰 Will apply ${creditsToApply} credits. Final amount: ${finalAmount}`);
    }

    // Prepare description
    const planName = tier.charAt(0).toUpperCase() + tier.slice(1);
    const cycleName = billingCycle === 'annual' ? 'Annual' : 'Monthly';
    const description = `Gmail Cleanup AI - ${planName} ${cycleName} Subscription`;

    const checkoutPayload = {
      data: {
        attributes: {
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          description,
          line_items: [{
            name: `${planName} Subscription (${cycleName})`,
            amount: finalAmount, // Already discounted
            currency: 'PHP',
            description: billingCycle === 'annual' 
              ? 'Unlimited email analysis, advanced AI features - Billed annually (Save 20%)'
              : 'Unlimited email analysis, advanced AI features',
            quantity: 1
          }],
          payment_method_types: ['card', 'grab_pay', 'paymaya', 'dob'],
          success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.FRONTEND_URL}/subscription`,
          metadata: {
            userId: user._id.toString(),
            googleId: user.googleId,
            email: user.email,
            plan: tier,
            billingCycle: billingCycle,
            originalAmount: amount.toString(),
            creditsApplied: creditsToApply.toString(),
            finalAmount: finalAmount.toString()
          }
        }
      }
    };

    logger.info('📤 Sending checkout request to PayMongo', JSON.stringify(checkoutPayload, null, 2));

    // Create checkout session
    const authWithColon = Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64');

    const checkout = await axios({
      method: 'POST',
      url: `${PAYMONGO_BASE_URL}/checkout_sessions`,
      headers: {
        'Authorization': `Basic ${authWithColon}`,
        'Content-Type': 'application/json'
      },
      data: checkoutPayload
    }).then(res => res.data);

    // Save checkout session ID
    user.paymongoCheckoutSessionId = checkout.data.id;
    await user.save();

    logger.info(`✅ Checkout created: ${checkout.data.id}`);

    res.json({
      success: true,
      checkoutUrl: checkout.data.attributes.checkout_url,
      sessionId: checkout.data.id,
      pricing: {
        tier,
        billingCycle,
        originalAmount: amount,
        creditsApplied: creditsToApply,
        finalAmount: finalAmount,
        remainingCredits: availableCredits - creditsToApply
      }
    });

  } catch (error) {
    logger.error('❌ Create checkout error', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to create checkout session',
      details: error.response?.data || error.message
    });
  }
});

// =====================
// Verify PayMongo Payment (UPDATED)
// =====================
router.post('/paymongo/verify-payment', protect, async (req, res) => {
  try {
    const { sessionId } = req.body;

    // Find user
    let user = await User.findOne({ googleId: req.user.id });
    if (!user) user = await User.findOne({ email: req.user.email });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    // Get checkout session from PayMongo
    const checkout = await paymongoRequest('GET', `/checkout_sessions/${sessionId}`);

    if (checkout.data.attributes.payment_status === 'paid') {
      
      const metadata = checkout.data.attributes.metadata || {};
      const tier = metadata.plan || 'pro';
      const billingCycle = metadata.billingCycle || 'monthly';
      const creditsApplied = parseInt(metadata.creditsApplied || '0');
      const finalAmount = parseInt(metadata.finalAmount || '0');
      const originalAmount = parseInt(metadata.originalAmount || '0');

      // Find or create subscription
      let subscription = await Subscription.findOne({ userId: user._id });
      
      if (!subscription) {
        subscription = new Subscription({
          userId: user._id,
          plan: tier,
          provider: 'paymongo',
          billingCycle,
          status: 'active'
        });
      }
      
      // Update subscription
      subscription.plan = tier;
      subscription.status = 'active';
      subscription.billingCycle = billingCycle;
      subscription.checkoutSessionId = sessionId;
      
      // Calculate billing period
      const now = new Date();
      subscription.currentPeriodStart = now;
      
      const periodEnd = new Date(now);
      if (billingCycle === 'annual') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }
      subscription.currentPeriodEnd = periodEnd;
      
      // ✅ ADD PAYMENT TO HISTORY
      const invoiceNumber = `INV-${Date.now()}-${user._id.toString().slice(-6)}`;
      
      subscription.paymentHistory.push({
        date: new Date(),
        amount: finalAmount,
        currency: 'PHP',
        status: 'paid',
        checkoutSessionId: sessionId,
        invoiceNumber: invoiceNumber,
        description: `${tier.toUpperCase()} Plan - ${billingCycle === 'annual' ? 'Annual' : 'Monthly'} Subscription`,
        method: 'paymongo',
        billingCycle: billingCycle,
        metadata: {
          originalAmount: originalAmount.toString(),
          creditsApplied: creditsApplied.toString(),
          finalAmount: finalAmount.toString()
        }
      });
      
      await subscription.save();

      // Deduct credits
      if (creditsApplied > 0) {
        user.availableReferralCredits = Math.max(0, (user.availableReferralCredits || 0) - creditsApplied);
        logger.info(`💰 Deducted ${creditsApplied} credits from ${user.email}. Remaining: ${user.availableReferralCredits}`);
      }
      
      // Upgrade user
      user.subscriptionTier = tier;
      user.emailQuotaLimit = 999999;
      user.subscriptionStatus = 'active';
      user.paymongoSubscriptionId = checkout.data.id;
      user.nextBillingDate = periodEnd;
      user.currentPeriodEnd = periodEnd;
      await user.save();

      // Activate referral if user was referred
      await activateUserReferral(user._id);

      logger.info(`✅ User upgraded to ${tier} (${billingCycle}): ${user.email}`);

      // ✅ SEND SUCCESS EMAIL
      const emailNotificationService = require('../services/emailNotificationService');
      try {
        await emailNotificationService.sendEmail({
          to: user.email,
          subject: '✅ Welcome to Premium! 🎉',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #10B981;">Welcome to Premium!</h2>
              <p>Hi ${user.name},</p>
              <p>Your subscription has been successfully activated. Thank you for upgrading!</p>
              
              <div style="background: #ECFDF5; border-left: 4px solid #10B981; padding: 15px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Your Subscription:</h3>
                <ul>
                  <li><strong>Plan:</strong> ${tier.toUpperCase()}</li>
                  <li><strong>Billing:</strong> ${billingCycle === 'annual' ? 'Annual (Save 20%)' : 'Monthly'}</li>
                  <li><strong>Amount Paid:</strong> ₱${(finalAmount / 100).toFixed(2)}</li>
                  ${creditsApplied > 0 ? `<li><strong>Credits Applied:</strong> -₱${(creditsApplied / 100).toFixed(2)}</li>` : ''}
                  <li><strong>Next Billing:</strong> ${periodEnd.toLocaleDateString()}</li>
                  <li><strong>Invoice:</strong> ${invoiceNumber}</li>
                </ul>
              </div>
              
              <div style="background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Premium Features Unlocked:</h3>
                <ul>
                  <li>✅ Unlimited email processing</li>
                  <li>✅ Unlimited AI cleanups</li>
                  <li>✅ Advanced AI insights</li>
                  <li>✅ Smart cleanup patterns</li>
                  <li>✅ Follow-up manager</li>
                  <li>✅ Bulk operations</li>
                  <li>✅ Email analytics</li>
                  ${creditsApplied > 0 ? `<li>✅ Referral credits (₱${(user.availableReferralCredits / 100).toFixed(2)} remaining)</li>` : ''}
                </ul>
              </div>
              
              <p>
                <a href="${process.env.FRONTEND_URL}/dashboard" 
                   style="background: #4F46E5; color: white; padding: 12px 24px; 
                          text-decoration: none; border-radius: 6px; display: inline-block;">
                  Start Using Premium Features
                </a>
              </p>
            </div>
          `
        });
      } catch (emailError) {
        logger.error('Failed to send welcome email:', emailError);
      }

      res.json({
        success: true,
        message: `Successfully upgraded to ${tier.charAt(0).toUpperCase() + tier.slice(1)}!`,
        subscription: {
          tier,
          billingCycle,
          status: 'active',
          nextBillingDate: periodEnd,
          invoiceNumber
        },
        creditsApplied: creditsApplied > 0 ? {
          amount: creditsApplied,
          amountFormatted: `₱${(creditsApplied / 100).toFixed(2)}`,
          remainingCredits: user.availableReferralCredits
        } : null
      });
    } else {
      res.json({
        success: false,
        message: 'Payment not completed',
        status: checkout.data.attributes.payment_status
      });
    }

  } catch (error) {
    logger.error('Verify payment error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================
// PayMongo Webhook Handler (UPDATED)
// =====================
router.post('/paymongo/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = req.body;

    logger.info('PayMongo webhook received:', event.data?.attributes?.type);

    // ✅ HANDLE SUCCESSFUL PAYMENT
    if (event.data?.attributes?.type === 'payment.paid') {
      const payment = event.data.attributes.data;
      const metadata = payment.attributes.metadata || {};
      const userId = metadata.userId;

      if (userId) {
        const user = await User.findById(userId);
        
        if (user) {
          const tier = metadata.plan || 'pro';
          const billingCycle = metadata.billingCycle || 'monthly';
          const creditsApplied = parseInt(metadata.creditsApplied || '0');
          const finalAmount = parseInt(metadata.finalAmount || '0');
          const originalAmount = parseInt(metadata.originalAmount || '0');
          
          // Find or create subscription
          let subscription = await Subscription.findOne({ userId });
          
          if (!subscription) {
            subscription = new Subscription({
              userId,
              plan: tier,
              provider: 'paymongo',
              billingCycle,
              status: 'active'
            });
          }
          
          // Update subscription
          subscription.plan = tier;
          subscription.status = 'active';
          subscription.billingCycle = billingCycle;
          subscription.checkoutSessionId = metadata.checkoutSessionId || payment.id;
          
          // Calculate billing period
          const now = new Date();
          subscription.currentPeriodStart = now;
          
          const periodEnd = new Date(now);
          if (billingCycle === 'annual') {
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
          } else {
            periodEnd.setMonth(periodEnd.getMonth() + 1);
          }
          subscription.currentPeriodEnd = periodEnd;
          
          // ✅ ADD PAYMENT TO HISTORY
          const invoiceNumber = `INV-${Date.now()}-${userId.toString().slice(-6)}`;
          
          subscription.paymentHistory.push({
            date: new Date(),
            amount: finalAmount,
            currency: 'PHP',
            status: 'paid',
            paymentIntentId: payment.id,
            checkoutSessionId: metadata.checkoutSessionId,
            invoiceNumber: invoiceNumber,
            description: `${tier.toUpperCase()} Plan - ${billingCycle === 'annual' ? 'Annual' : 'Monthly'} Subscription`,
            method: 'paymongo',
            billingCycle: billingCycle,
            metadata: {
              originalAmount: originalAmount.toString(),
              creditsApplied: creditsApplied.toString(),
              finalAmount: finalAmount.toString()
            }
          });
          
          await subscription.save();
          
          // Deduct credits if applied
          if (creditsApplied > 0) {
            user.availableReferralCredits = Math.max(0, (user.availableReferralCredits || 0) - creditsApplied);
            logger.info(`💰 Webhook: Deducted ${creditsApplied} credits from ${user.email}. Remaining: ${user.availableReferralCredits}`);
          }
          
          // Update user
          user.subscriptionTier = tier;
          user.emailQuotaLimit = 999999;
          user.subscriptionStatus = 'active';
          user.nextBillingDate = periodEnd;
          user.currentPeriodEnd = periodEnd;
          await user.save();
          
          // Activate referral
          await activateUserReferral(user._id);
          
          // ✅ SEND PAYMENT SUCCESS EMAIL
          const emailNotificationService = require('../services/emailNotificationService');
          try {
            await emailNotificationService.sendEmail({
              to: user.email,
              subject: '✅ Payment Successful - Subscription Activated',
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #10B981;">Payment Successful!</h2>
                  <p>Hi ${user.name},</p>
                  <p>Thank you for your payment. Your subscription has been activated.</p>
                  
                  <div style="background: #ECFDF5; border-left: 4px solid #10B981; padding: 15px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">Subscription Details:</h3>
                    <ul>
                      <li><strong>Plan:</strong> ${tier.toUpperCase()}</li>
                      <li><strong>Billing Cycle:</strong> ${billingCycle === 'annual' ? 'Annual' : 'Monthly'}</li>
                      <li><strong>Amount Paid:</strong> ₱${(finalAmount / 100).toFixed(2)}</li>
                      ${creditsApplied > 0 ? `<li><strong>Credits Applied:</strong> -₱${(creditsApplied / 100).toFixed(2)}</li>` : ''}
                      <li><strong>Next Billing Date:</strong> ${periodEnd.toLocaleDateString()}</li>
                      <li><strong>Invoice Number:</strong> ${invoiceNumber}</li>
                    </ul>
                  </div>
                  
                  <p>You now have unlimited access to all premium features!</p>
                  
                  <p>
                    <a href="${process.env.FRONTEND_URL}/settings/subscription" 
                       style="background: #4F46E5; color: white; padding: 12px 24px; 
                              text-decoration: none; border-radius: 6px; display: inline-block;">
                      View Subscription
                    </a>
                  </p>
                  
                  <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
                  <p style="color: #6B7280; font-size: 12px;">
                    Payment processed on ${new Date().toLocaleString()}
                  </p>
                </div>
              `
            });
          } catch (emailError) {
            logger.error('Failed to send payment success email:', emailError);
          }
          
          logger.info(`✅ Webhook: User upgraded to ${tier} (${billingCycle}): ${user.email}`);
        }
      }
    }

    // ✅ HANDLE FAILED PAYMENT
    if (event.data?.attributes?.type === 'payment.failed') {
      const payment = event.data.attributes.data;
      const userId = payment.attributes.metadata?.userId;
      
      if (userId) {
        logger.error(`❌ Payment failed for user: ${userId}`);
        
        const user = await User.findById(userId);
        const subscription = await Subscription.findOne({ userId });
        
        if (user && subscription) {
          // Add failed payment to history
          subscription.paymentHistory.push({
            date: new Date(),
            amount: parseInt(payment.attributes.metadata?.finalAmount || '0'),
            currency: 'PHP',
            status: 'failed',
            paymentIntentId: payment.id,
            description: `Payment attempt failed`,
            method: 'paymongo'
          });
          
          subscription.status = 'past_due';
          await subscription.save();
          
          user.subscriptionStatus = 'past_due';
          await user.save();
          
          // Send payment failure email
          const emailNotificationService = require('../services/emailNotificationService');
          try {
            await emailNotificationService.sendEmail({
              to: user.email,
              subject: '⚠️ Payment Failed - Action Required',
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #EF4444;">Payment Failed</h2>
                  <p>Hi ${user.name},</p>
                  <p>We were unable to process your payment for your subscription.</p>
                  
                  <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 15px; margin: 20px 0;">
                    <p><strong>Action Required:</strong> Please update your payment method to continue enjoying premium features.</p>
                  </div>
                  
                  <p>
                    <a href="${process.env.FRONTEND_URL}/settings/subscription" 
                       style="background: #EF4444; color: white; padding: 12px 24px; 
                              text-decoration: none; border-radius: 6px; display: inline-block;">
                      Update Payment Method
                    </a>
                  </p>
                </div>
              `
            });
          } catch (emailError) {
            logger.error('Failed to send payment failure email:', emailError);
          }
        }
      }
    }

    res.json({ success: true });

  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;