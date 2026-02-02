const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Referral = require('../models/Referral');
const paymentService = require('../services/paymentService');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../utils/logger');

exports.getSubscription = async (req, res) => {
  try {
    const user = req.user;
    const subscription = await Subscription.findOne({ userId: user._id });
    res.json({
      success: true,
      subscription: {
        tier: user.subscriptionTier,
        status: user.subscriptionStatus,
        quotaUsed: user.emailQuotaUsed,
        quotaLimit: user.emailQuotaLimit,
        isBeta: user.isBetaUser,
        details: subscription
      }
    });
  } catch (error) {
    logger.error('Get subscription error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subscription' });
  }
};

exports.createSubscription = async (req, res) => {
  try {
    const { plan, paymentMethod } = req.body;
    if (!['pro', 'premium', 'enterprise'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Invalid plan' });
    }

    const result = await paymentService.createSubscription(req.user._id, plan, paymentMethod);
    
    // ✅ NEW: Activate referral if user was referred
    await activateUserReferral(req.user._id);
    
    await emailNotificationService.sendSubscriptionUpdate(req.user.email, 'active', plan);

    res.json({ success: true, message: 'Subscription created successfully', ...result });
  } catch (error) {
    logger.error('Create subscription error:', error);
    res.status(500).json({ success: false, message: 'Subscription creation failed' });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    await paymentService.cancelSubscription(req.user._id);
    await emailNotificationService.sendSubscriptionUpdate(req.user.email, 'canceled', req.user.subscriptionTier);
    res.json({ success: true, message: 'Subscription will be canceled at period end' });
  } catch (error) {
    logger.error('Cancel subscription error:', error);
    res.status(500).json({ success: false, message: 'Cancellation failed' });
  }
};

// ✅ NEW: Activate referral when user subscribes
async function activateUserReferral(userId) {
  try {
    // Find pending referral for this user
    const referral = await Referral.findOne({
      referredUserId: userId,
      status: 'pending'
    });

    if (!referral) {
      logger.info(`No pending referral found for user ${userId}`);
      return;
    }

    // Update referral status
    referral.status = 'active';
    referral.subscribedAt = new Date();
    await referral.save();

    // Add credits to referrer (max $50/year = 5000 cents)
    const referrer = await User.findById(referral.referrerId);
    
    if (!referrer) {
      logger.error(`Referrer not found for referral ${referral._id}`);
      return;
    }

    const currentYearCredits = await calculateYearlyCredits(referral.referrerId);
    const maxYearlyCredits = 5000; // $50 in cents
    const creditAmount = 200; // $2 in cents

    if (currentYearCredits + creditAmount <= maxYearlyCredits) {
      referrer.totalReferralCredits = (referrer.totalReferralCredits || 0) + creditAmount;
      referrer.availableReferralCredits = (referrer.availableReferralCredits || 0) + creditAmount;
      await referrer.save();

      // Send notification email to referrer
      if (emailNotificationService && emailNotificationService.sendReferralReward) {
        await emailNotificationService.sendReferralReward(
          referrer.email, 
          'credit', 
          { amount: '$2.00' }
        );
      }

      logger.info(`✅ Referral activated! User ${userId} subscribed. Referrer ${referrer._id} earned $2 credit.`);
    } else {
      logger.info(`⚠️ Referral activated but referrer ${referrer._id} reached max yearly credits ($50)`);
    }

  } catch (error) {
    logger.error('Error activating referral:', error);
    // Don't throw - this shouldn't block the subscription
  }
}

// Helper function to calculate credits earned this year
async function calculateYearlyCredits(userId) {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  
  const referrals = await Referral.find({
    referrerId: userId,
    status: 'active',
    subscribedAt: { $gte: startOfYear }
  });

  return referrals.reduce((total, ref) => total + (ref.rewardAmount || 200), 0);
}

module.exports = exports;