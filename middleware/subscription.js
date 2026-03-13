// middleware/subscription.js
const User = require('../models/User');
const logger = require('../utils/logger');

// ✅ EXISTING: Check email quota (keep as is)
exports.checkEmailQuota = async (req, res, next) => {
  try {
    console.log('🔍 Quota check - req.user:', req.user);
    
    // ✅ Get user ID from Passport session
    const userId = req.user.id || req.user._id || req.user.googleId;
    console.log('🔍 Looking for user with ID:', userId);
    
    // ✅ Always search by googleId (since Passport stores Google ID)
    const user = await User.findById(userId) || await User.findOne({ googleId: userId });
    
    if (!user) {
      console.error('❌ User not found. googleId:', userId);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found in database' 
      });
    }

    console.log('✅ Found user:', user.email);

    const now = new Date();
    const lastReset = new Date(user.lastQuotaReset || now);
    
    // Reset quota if new month
    if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
      user.emailQuotaUsed = 0;
      user.lastQuotaReset = now;
      await user.save();
      console.log('🔄 Quota reset for new month');
    }
    
    // ✅ Check quota limit based on tier
    const tier = user.subscriptionTier || 'free';
    const limit = user.emailQuotaLimit || 100;
    const used = user.emailQuotaUsed || 0;
    
    // ✅ Premium/Enterprise users have unlimited quota
    if (tier === 'premium' || tier === 'enterprise' || tier === 'pro') {
      console.log('✅ Premium user - unlimited quota');
      req.user = user;
      return next();
    }
    
    // Original free tier check
    if (tier === 'free' && used >= limit) {
      return res.status(403).json({ 
        success: false, 
        message: 'Monthly email quota exceeded. Please upgrade your plan.',
        quota: {
          used: used,
          limit: limit,
          tier: tier
        }
      });
    }
    
    console.log('✅ Quota check passed:', {
      user: user.email,
      used: used,
      limit: limit,
      tier: tier
    });
    
    // ✅ Attach full user document to request
    req.user = user;
    next();
    
  } catch (error) {
    console.error('❌ Quota check error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Quota check failed',
      error: error.message 
    });
  }
};

// ✅ EXISTING: Require premium (enhanced)
exports.requirePremium = async (req, res, next) => {
  try {
    const user = req.user;
console.log('🔒 REQUIRE PREMIUM CHECK - email:', user?.email, '| tier:', user?.subscriptionTier);
    
    // ✅ ENHANCED: Include trial check
    const isPremium = user.subscriptionTier === 'premium' || 
                     user.subscriptionTier === 'pro' || 
                     user.subscriptionTier === 'enterprise';
    
    const isTrialActive = user.trialEndDate && new Date() < new Date(user.trialEndDate);
    
    if (isPremium || isTrialActive) {
      logger.info(`✅ Premium access granted for ${user.email}`);
      return next();
    }
    
    logger.info(`🔒 Premium access denied for ${user.email}`);
    return res.status(403).json({
      success: false,
      message: 'This feature requires a Premium subscription or active trial',
      upgrade: true,
      upgradeUrl: '/subscription',
      userTier: user.subscriptionTier,
      trialActive: isTrialActive
    });
  } catch (error) {
    logger.error('Premium check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ✅ NEW: Check cleanup quota (3/month for free, unlimited for premium)
exports.checkCleanupQuota = async (req, res, next) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }
    
    // Premium/Pro/Enterprise users have unlimited
    const isPremium = user.subscriptionTier === 'premium' || 
                     user.subscriptionTier === 'pro' || 
                     user.subscriptionTier === 'enterprise';
    
    if (isPremium) {
      logger.info(`✅ Unlimited cleanup for premium user ${user.email}`);
      return next();
    }
    
    // Trial users have unlimited
    const isTrialActive = user.trialEndDate && new Date() < new Date(user.trialEndDate);
    if (isTrialActive) {
      logger.info(`✅ Unlimited cleanup for trial user ${user.email}`);
      return next();
    }
    
    // Free users - check and reset quota if needed
    const now = new Date();
    const lastReset = user.lastCleanupReset || now;
    const daysSinceReset = (now - lastReset) / (1000 * 60 * 60 * 24);
    
    // Auto-reset every 30 days
    if (daysSinceReset >= 30) {
      user.freeCleanupCount = 3;
      user.lastCleanupReset = now;
      await user.save();
      logger.info(`🔄 Reset cleanup quota for ${user.email}`);
    }
    
    // Check quota
    if (user.freeCleanupCount <= 0) {
      logger.info(`🔒 Cleanup quota exceeded for ${user.email}`);
      return res.status(403).json({
        success: false,
        error: 'Quota exceeded',
        message: 'You have used all 3 free cleanups this month. Upgrade to Premium for unlimited access!',
        remainingCleanups: 0,
        nextResetDate: new Date(user.lastCleanupReset.getTime() + (30 * 24 * 60 * 60 * 1000)),
        upgradeUrl: '/subscription'
      });
    }
    
    logger.info(`✅ Cleanup allowed for ${user.email}. Remaining: ${user.freeCleanupCount}`);
    next();
    
  } catch (error) {
    logger.error('Cleanup quota check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify cleanup quota'
    });
  }
};

// ✅ NEW: Middleware to deduct cleanup after successful operation
exports.deductCleanup = async (req, res, next) => {
  try {
    const user = req.user;
    
    // Only deduct for free users
    const isPremium = user.subscriptionTier === 'premium' || 
                     user.subscriptionTier === 'pro' || 
                     user.subscriptionTier === 'enterprise';
    const isTrialActive = user.trialEndDate && new Date() < new Date(user.trialEndDate);
    
    if (!isPremium && !isTrialActive) {
      user.freeCleanupCount -= 1;
      user.totalCleanupsUsed += 1;
      await user.save();
      
      logger.info(`📉 Cleanup deducted for ${user.email}. Remaining: ${user.freeCleanupCount}`);
      
      // Add remaining count to response
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        return originalJson({
          ...data,
          remainingCleanups: user.freeCleanupCount,
          quotaInfo: {
            used: 3 - user.freeCleanupCount,
            limit: 3,
            remaining: user.freeCleanupCount
          }
        });
      };
    } else {
      // Premium users - just track usage
      user.totalCleanupsUsed += 1;
      await user.save();
    }
    
    next();
    
  } catch (error) {
    logger.error('Cleanup deduction error:', error);
    next(); // Don't block the response if deduction fails
  }
};