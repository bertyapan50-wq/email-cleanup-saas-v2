require('dotenv').config();

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Referral = require('../models/Referral');
const logger = require('../utils/logger');
const { protect } = require('../middleware/auth');

// =====================
// LemonSqueezy Config
// =====================
const LS_API_KEY = process.env.LEMONSQUEEZY_API_KEY;
const LS_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID;
const LS_MONTHLY_VARIANT_ID = process.env.LEMONSQUEEZY_MONTHLY_VARIANT_ID;
const LS_ANNUAL_VARIANT_ID = process.env.LEMONSQUEEZY_ANNUAL_VARIANT_ID;
const LS_WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

// ✅ ADD THIS:
console.log('🔑 LS Config check:', {
  apiKey: LS_API_KEY ? '✅' : '❌ MISSING',
  storeId: LS_STORE_ID ? '✅' : '❌ MISSING',
  monthlyVariant: LS_MONTHLY_VARIANT_ID ? '✅' : '❌ MISSING',
  annualVariant: LS_ANNUAL_VARIANT_ID ? '✅' : '❌ MISSING',
});

// ✅ ADD THIS — router-level logger:
router.use((req, res, next) => {
  console.log('🛣️ LS Router hit:', req.method, req.path);
  next();
});

const LS_BASE_URL = 'https://api.lemonsqueezy.com/v1';

// =====================
// Helper: LS API Request
// =====================
const lsRequest = async (method, endpoint, data = null) => {
  try {
    const response = await axios({
      method,
      url: `${LS_BASE_URL}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${LS_API_KEY}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json'
      },
      data
    });
    return response.data;
  } catch (error) {
    logger.error('LemonSqueezy API Error:', error.response?.data || error.message);
    throw error;
  }
};

// =====================
// Helper: Activate Referral (copied from subscription.js)
// =====================
async function activateUserReferral(userId) {
  try {
    const referral = await Referral.findOne({
      referredUserId: userId,
      status: 'pending'
    });

    if (!referral) return;

    referral.status = 'active';
    referral.subscribedAt = new Date();
    referral.rewardAmount = 2000;
    await referral.save();

    const referrer = await User.findById(referral.referrerId);
    if (referrer) {
      const startOfYear = new Date(new Date().getFullYear(), 0, 1);
      const referrals = await Referral.find({
        referrerId: referral.referrerId,
        status: 'active',
        subscribedAt: { $gte: startOfYear }
      });
      const currentYearCredits = referrals.reduce((total, ref) => total + (ref.rewardAmount || 0), 0);
      const maxYearlyCredits = 50000;
      const creditAmount = 2000;

      if (currentYearCredits + creditAmount <= maxYearlyCredits) {
        referrer.totalReferralCredits = (referrer.totalReferralCredits || 0) + creditAmount;
        referrer.availableReferralCredits = (referrer.availableReferralCredits || 0) + creditAmount;
        await referrer.save();
        logger.info(`✅ Referral activated! Referrer earned ₱20 credit.`);
      }
    }
  } catch (error) {
    logger.error('Error activating referral:', error);
  }
}

// =====================
// POST /api/lemonsqueezy/create-checkout
// Creates a LemonSqueezy checkout URL
// =====================
router.post('/create-checkout', protect, async (req, res) => {
  try {
    console.log('🔍 Create checkout called');
    console.log('🔍 req.user:', req.user?.email);
    console.log('🔍 req.body:', req.body);

    const { billingCycle = 'monthly' } = req.body;

    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid billing cycle. Must be "monthly" or "annual"'
      });
    }

    // Find or create user
    let user = await User.findOne({ googleId: req.user.id });
    if (!user) user = await User.findOne({ email: req.user.email });
    if (!user) {
      user = await User.create({
        googleId: req.user.id,
        email: req.user.email,
        name: req.user.name || 'No Name',
        subscriptionTier: 'free',
        emailQuotaLimit: 100
      });
    }

    // Pick variant
    const variantId = billingCycle === 'annual'
      ? LS_ANNUAL_VARIANT_ID
      : LS_MONTHLY_VARIANT_ID;

    // Build checkout payload
    const checkoutPayload = {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_options: {
            embed: false,
            media: false,
            logo: true
          },
          checkout_data: {
            email: user.email,
            name: user.name,
            custom: {
              userId: user._id.toString(),
              googleId: user.googleId || '',
              billingCycle,
              plan: 'pro'
            }
          },
          expires_at: null,
          preview: false,
          test_mode: LS_API_KEY?.includes('_test_')
        },
        relationships: {
          store: {
            data: { type: 'stores', id: String(LS_STORE_ID) }
          },
          variant: {
            data: { type: 'variants', id: String(variantId) }
          }
        }
      }
    };

    const checkout = await lsRequest('POST', '/checkouts', checkoutPayload);

    const checkoutUrl = checkout.data?.attributes?.url;

    if (!checkoutUrl) {
      throw new Error('No checkout URL returned from LemonSqueezy');
    }

    // Save LS customer info
    user.lemonSqueezyOrderId = checkout.data?.id;
    await user.save();

    logger.info(`✅ LS Checkout created for ${user.email}: ${checkoutUrl}`);

    res.json({
      success: true,
      checkoutUrl,
      checkoutId: checkout.data?.id
    });

  } catch (error) {
    logger.error('❌ Create LS checkout error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create checkout session',
      details: error.response?.data || error.message
    });
  }
});

// =====================
// GET /api/lemonsqueezy/status
// Get current subscription status
// =====================
router.get('/status', protect, async (req, res) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      subscription: {
        tier: user.subscriptionTier || 'free',
        status: user.subscriptionStatus || 'inactive',
        quotaUsed: user.emailQuotaUsed || 0,
        quotaLimit: user.emailQuotaLimit || 100,
        currentPeriodEnd: user.currentPeriodEnd,
        nextBillingDate: user.nextBillingDate,
        isPro: user.subscriptionTier === 'pro' || user.subscriptionTier === 'premium',
        lemonSqueezySubscriptionId: user.lemonSqueezySubscriptionId || null
      }
    });
  } catch (error) {
    logger.error('Get LS status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================
// POST /api/lemonsqueezy/cancel
// Cancel subscription
// =====================
router.post('/cancel', protect, async (req, res) => {
  try {
    let user = await User.findOne({ googleId: req.user.id });
    if (!user) user = await User.findOne({ email: req.user.email });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const lsSubId = user.lemonSqueezySubscriptionId;
    if (!lsSubId) {
      return res.status(400).json({ success: false, error: 'No active LemonSqueezy subscription found' });
    }

    // Cancel at period end via LS API
    await lsRequest('DELETE', `/subscriptions/${lsSubId}`);

    // Update DB
    const subscription = await Subscription.findOne({ userId: user._id });
    if (subscription) {
      subscription.cancelAtPeriodEnd = true;
      subscription.canceledAt = new Date();
      await subscription.save();
    }

    user.subscriptionStatus = 'canceled';
    await user.save();

    logger.info(`✅ LS Subscription canceled for ${user.email}`);

    res.json({
      success: true,
      message: 'Subscription will be canceled at end of billing period'
    });

  } catch (error) {
    logger.error('❌ Cancel LS subscription error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================
// POST /api/lemonsqueezy/webhook
// Handles LemonSqueezy webhook events
// =====================
router.post('/webhook', async (req, res) => {
  try {
    // ✅ Verify webhook signature
    const secret = LS_WEBHOOK_SECRET;
    const signature = req.headers['x-signature'];

    if (secret && signature) {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(req.body).digest('hex');

      if (digest !== signature) {
        logger.error('❌ LS Webhook signature mismatch');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const payload = JSON.parse(req.body.toString());
    const eventName = payload.meta?.event_name;
    const customData = payload.meta?.custom_data || {};

    logger.info(`📦 LS Webhook received: ${eventName}`);

    // =====================
    // ORDER CREATED (one-time or first payment)
    // =====================
    if (eventName === 'order_created') {
      const order = payload.data;
      const userId = customData.userId;
      const billingCycle = customData.billingCycle || 'monthly';
      const plan = customData.plan || 'pro';

      if (!userId) {
        logger.error('❌ No userId in webhook custom data');
        return res.json({ success: true });
      }

      const user = await User.findById(userId);
      if (!user) {
        logger.error(`❌ User not found: ${userId}`);
        return res.json({ success: true });
      }

      // Calculate period
      const now = new Date();
      const periodEnd = new Date(now);
      if (billingCycle === 'annual') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      const amount = order.attributes?.total || 0;
      const invoiceNumber = `LS-INV-${Date.now()}-${userId.toString().slice(-6)}`;

      // Find or create subscription
      let subscription = await Subscription.findOne({ userId: user._id });
      if (!subscription) {
        subscription = new Subscription({
          userId: user._id,
          plan,
          provider: 'lemonsqueezy',
          billingCycle,
          status: 'active'
        });
      }

      subscription.plan = plan;
      subscription.status = 'active';
      subscription.billingCycle = billingCycle;
      subscription.provider = 'lemonsqueezy';
      subscription.currentPeriodStart = now;
      subscription.currentPeriodEnd = periodEnd;

      // Add to payment history
      subscription.paymentHistory.push({
        date: now,
        amount,
        currency: 'USD',
        status: 'paid',
        invoiceNumber,
        description: `InboxDetox Pro - ${billingCycle === 'annual' ? 'Annual' : 'Monthly'} Subscription`,
        method: 'lemonsqueezy',
        billingCycle
      });

      await subscription.save();

      // Update user
      user.subscriptionTier = plan;
      user.subscriptionStatus = 'active';
      user.emailQuotaLimit = 999999;
      user.lemonSqueezyOrderId = order.id;
      user.currentPeriodEnd = periodEnd;
      user.nextBillingDate = periodEnd;
      await user.save();

      // Activate referral
      await activateUserReferral(user._id);

      logger.info(`✅ LS Order: User upgraded to ${plan} (${billingCycle}): ${user.email}`);
    }

    // =====================
    // SUBSCRIPTION CREATED
    // =====================
    if (eventName === 'subscription_created') {
      const lsSub = payload.data;
      const userId = customData.userId;

      if (userId) {
        const user = await User.findById(userId);
        if (user) {
          user.lemonSqueezySubscriptionId = lsSub.id;
          await user.save();

          const subscription = await Subscription.findOne({ userId: user._id });
          if (subscription) {
            subscription.subscriptionId = lsSub.id;
            await subscription.save();
          }

          logger.info(`✅ LS Subscription ID saved for ${user.email}: ${lsSub.id}`);
        }
      }
    }

    // =====================
    // SUBSCRIPTION UPDATED (renewal, upgrade, downgrade)
    // =====================
    if (eventName === 'subscription_updated') {
      const lsSub = payload.data;
      const userId = customData.userId;

      if (userId) {
        const user = await User.findById(userId);
        if (user) {
          const status = lsSub.attributes?.status;

          // Map LS status to our status
          const statusMap = {
            'active': 'active',
            'cancelled': 'canceled',
            'expired': 'inactive',
            'past_due': 'past_due',
            'on_trial': 'active',
            'paused': 'inactive'
          };

          const mappedStatus = statusMap[status] || 'inactive';

          user.subscriptionStatus = mappedStatus;

          // Update period end if available
          const renewsAt = lsSub.attributes?.renews_at;
          if (renewsAt) {
            user.currentPeriodEnd = new Date(renewsAt);
            user.nextBillingDate = new Date(renewsAt);
          }

          // If canceled, downgrade after period end
          if (status === 'cancelled' || status === 'expired') {
            user.subscriptionTier = 'free';
            user.emailQuotaLimit = 100;
          }

          await user.save();

          // Update subscription doc
          const subscription = await Subscription.findOne({ userId: user._id });
          if (subscription) {
            subscription.status = mappedStatus;
            subscription.cancelAtPeriodEnd = lsSub.attributes?.cancelled || false;
            if (renewsAt) subscription.currentPeriodEnd = new Date(renewsAt);
            await subscription.save();
          }

          logger.info(`✅ LS Subscription updated for ${user.email}: ${status}`);
        }
      }
    }

    // =====================
    // SUBSCRIPTION PAYMENT SUCCESS (renewal)
    // =====================
    if (eventName === 'subscription_payment_success') {
      const payment = payload.data;
      const userId = customData.userId;

      if (userId) {
        const user = await User.findById(userId);
        if (user) {
          const subscription = await Subscription.findOne({ userId: user._id });
          if (subscription) {
            const invoiceNumber = `LS-INV-${Date.now()}-${userId.toString().slice(-6)}`;
            subscription.paymentHistory.push({
              date: new Date(),
              amount: payment.attributes?.total || 0,
              currency: 'USD',
              status: 'paid',
              invoiceNumber,
              description: 'Subscription Renewal',
              method: 'lemonsqueezy',
              billingCycle: subscription.billingCycle
            });
            await subscription.save();
          }

          // Extend period
          const now = new Date();
          const periodEnd = new Date(now);
          if (subscription?.billingCycle === 'annual') {
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
          } else {
            periodEnd.setMonth(periodEnd.getMonth() + 1);
          }

          user.subscriptionStatus = 'active';
          user.currentPeriodEnd = periodEnd;
          user.nextBillingDate = periodEnd;
          await user.save();

          logger.info(`✅ LS Renewal payment success for ${user.email}`);
        }
      }
    }

    // =====================
    // SUBSCRIPTION PAYMENT FAILED
    // =====================
    if (eventName === 'subscription_payment_failed') {
      const userId = customData.userId;

      if (userId) {
        const user = await User.findById(userId);
        if (user) {
          user.subscriptionStatus = 'past_due';
          await user.save();

          const subscription = await Subscription.findOne({ userId: user._id });
          if (subscription) {
            subscription.status = 'past_due';
            await subscription.save();
          }

          logger.error(`❌ LS Payment failed for ${user.email}`);
        }
      }
    }

    res.json({ success: true });

  } catch (error) {
    logger.error('❌ LS Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 
"" 
