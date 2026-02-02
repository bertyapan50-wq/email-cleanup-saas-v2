const User = require('../models/User');
const Referral = require('../models/Referral');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../utils/logger');

// Get user's referral information
exports.getReferralInfo = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get user with referral code
    const user = await User.findById(userId).select('email name referralCode totalReferralCredits availableReferralCredits');

    if (!user || !user.referralCode) {
      return res.status(404).json({ error: 'Referral code not found' });
    }

    // Get all referrals made by this user
    const referrals = await Referral.find({ referrerId: userId })
      .populate('referredUserId', 'email name')
      .sort({ createdAt: -1 });

    // Calculate stats
    const stats = {
      totalReferrals: referrals.length,
      activeReferrals: referrals.filter(r => r.status === 'active').length,
      pendingReferrals: referrals.filter(r => r.status === 'pending').length,
      earnedRewards: user.totalReferralCredits || 0
    };

    // Format referral data
    const referralData = referrals.map(ref => ({
      id: ref._id,
      name: ref.referredUserId?.name || 'Pending User',
      email: ref.referredUserId?.email || ref.referredEmail || 'N/A',
      status: ref.status,
      signedUpAt: ref.signedUpAt,
      subscribedAt: ref.subscribedAt,
      rewardAmount: ref.rewardAmount,
      rewardClaimed: ref.rewardClaimed
    }));

    // Generate referral link
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const referralLink = `${baseUrl}/signup?ref=${user.referralCode}`;

    res.json({
      referralCode: user.referralCode,
      referralLink,
      stats,
      referrals: referralData,
      availableCredits: user.availableReferralCredits || 0
    });

  } catch (error) {
    logger.error('Error fetching referral info:', error);
    res.status(500).json({ error: 'Failed to fetch referral information' });
  }
};

// Track when someone signs up using a referral code
exports.trackReferralSignup = async (req, res) => {
  try {
    const { referralCode, userId } = req.body;

    console.log('📥 Track referral signup:', { referralCode, userId });

    if (!referralCode) {
      return res.status(400).json({ error: 'Referral code is required' });
    }

    // Find the referrer user
    const referrer = await User.findOne({ referralCode });

    if (!referrer) {
      return res.status(404).json({ error: 'Invalid referral code' });
    }

    // Check if user is trying to use their own code
    if (userId && referrer._id.toString() === userId.toString()) {
      return res.status(400).json({ error: 'Cannot use your own referral code' });
    }

    // ✅ NEW: Get referred user's email
    let referredEmail = req.body.email || null;
    
    if (userId) {
      const referredUser = await User.findById(userId);
      if (referredUser) {
        referredEmail = referredUser.email;
        
        // ✅ NEW: Check if this user already has a referral
        const existingReferral = await Referral.findOne({
          $or: [
            { referredUserId: userId },
            { referredEmail: referredEmail }
          ]
        });

        if (existingReferral) {
          console.log('⚠️ Referral already exists for this user');
          return res.json({
            success: true,
            message: 'Referral already tracked',
            trialExtension: 14,
            existing: true
          });
        }
        
        // Update referredBy in User model
        referredUser.referredBy = referralCode;
        await referredUser.save();
        console.log('✅ Updated user referredBy:', referredEmail);
      }
    }

    // ✅ NEW: If no userId but has email, check email too
    if (!userId && referredEmail) {
      const existingReferral = await Referral.findOne({ referredEmail });
      
      if (existingReferral) {
        console.log('⚠️ Referral already exists for this email');
        return res.json({
          success: true,
          message: 'Referral already tracked',
          trialExtension: 14,
          existing: true
        });
      }
    }

    // Create referral record
    const referral = await Referral.create({
      referrerId: referrer._id,
      referredUserId: userId || null,
      referredEmail: referredEmail,
      status: 'pending',
      signedUpAt: new Date()
    });

    console.log('✅ Created referral:', referral);

    res.json({
      success: true,
      message: 'Referral tracked successfully',
      trialExtension: 14
    });

  } catch (error) {
    logger.error('Error tracking referral:', error);
    res.status(500).json({ error: 'Failed to track referral' });
  }
};

// Called when referred user subscribes to premium
exports.activateReferral = async (req, res) => {
  try {
    const { userId } = req.body;

    // Find pending referral for this user
    const referral = await Referral.findOne({
      referredUserId: userId,
      status: 'pending'
    });

    if (!referral) {
      return res.status(404).json({ error: 'No pending referral found' });
    }

    // Update referral status
    referral.status = 'active';
    referral.subscribedAt = new Date();
    await referral.save();

    // Add credits to referrer (max $50/year = 5000 cents)
    const referrer = await User.findById(referral.referrerId);
    const currentYearCredits = await calculateYearlyCredits(referral.referrerId);
    const maxYearlyCredits = 5000; // $50 in cents
    const creditAmount = 200; // $2 in cents

    if (currentYearCredits + creditAmount <= maxYearlyCredits) {
      referrer.totalReferralCredits = (referrer.totalReferralCredits || 0) + creditAmount;
      referrer.availableReferralCredits = (referrer.availableReferralCredits || 0) + creditAmount;
      await referrer.save();

      // Send notification email
      if (emailNotificationService && emailNotificationService.sendReferralReward) {
        await emailNotificationService.sendReferralReward(
          referrer.email, 
          'credit', 
          { amount: '$2.00' }
        );
      }

      res.json({
        success: true,
        message: 'Referral activated and credits awarded',
        creditsAwarded: creditAmount
      });
    } else {
      res.json({
        success: true,
        message: 'Referral activated but max yearly credits reached',
        creditsAwarded: 0
      });
    }

  } catch (error) {
    logger.error('Error activating referral:', error);
    res.status(500).json({ error: 'Failed to activate referral' });
  }
};

// Claim referral reward
exports.claimReward = async (req, res) => {
  try {
    const userId = req.user._id;
    const { referralId } = req.params;

    // Find the referral
    const referral = await Referral.findOne({
      _id: referralId,
      referrerId: userId,
      status: 'active',
      rewardClaimed: false
    });

    if (!referral) {
      return res.status(404).json({ error: 'Referral not found or already claimed' });
    }

    // Mark as claimed
    referral.rewardClaimed = true;
    await referral.save();

    res.json({
      success: true,
      message: 'Reward claimed successfully',
      amount: referral.rewardAmount
    });

  } catch (error) {
    logger.error('Error claiming reward:', error);
    res.status(500).json({ error: 'Failed to claim reward' });
  }
};

// Helper function to calculate credits earned this year
async function calculateYearlyCredits(userId) {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  
  const referrals = await Referral.find({
    referrerId: userId,
    status: 'active',
    subscribedAt: { $gte: startOfYear }
  });

  return referrals.reduce((total, ref) => total + ref.rewardAmount, 0);
}

// OLD FUNCTIONS - kept for backward compatibility
exports.getReferralStats = async (req, res) => {
  try {
    const user = req.user;
    const referrals = await Referral.find({ referrerId: user._id });
    const completed = referrals.filter(r => r.status === 'active').length;

    res.json({
      success: true,
      referralCode: user.referralCode,
      totalReferrals: referrals.length,
      completedReferrals: completed,
      pendingReferrals: referrals.filter(r => r.status === 'pending').length,
      rewards: { 
        credits: user.availableReferralCredits || 0,
        monthsFree: Math.floor(completed / 3), 
        yearsFree: Math.floor(completed / 10), 
        lifetimePremium: completed >= 25 
      },
      currentRewards: user.referralRewards
    });
  } catch (error) {
    logger.error('Get referral stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch referral stats' });
  }
};

exports.applyReferralCode = async (req, res) => {
  try {
    const { referralCode } = req.body;
    const user = req.user;

    if (user.referredBy) {
      return res.status(400).json({ success: false, message: 'You have already used a referral code' });
    }

    const referrer = await User.findOne({ referralCode });
    if (!referrer) {
      return res.status(404).json({ success: false, message: 'Invalid referral code' });
    }
    
    if (referrer._id.equals(user._id)) {
      return res.status(400).json({ success: false, message: 'Cannot use your own referral code' });
    }

    await Referral.create({ 
      referrerId: referrer._id, 
      referredUserId: user._id, 
      referredEmail: user.email, 
      status: 'pending',
      signedUpAt: new Date()
    });
    
    user.referredBy = referralCode;
    await user.save();

    res.json({ success: true, message: 'Referral code applied successfully! You get 14-day trial.' });
  } catch (error) {
    logger.error('Apply referral error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply referral code' });
  }
};

// ✅ NEW: Generate referral code for existing users without one
exports.generateReferralCode = async (req, res) => {
  try {
    const user = req.user;
    
    if (user.referralCode) {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.json({ 
        success: true, 
        referralCode: user.referralCode,
        referralLink: `${baseUrl}/signup?ref=${user.referralCode}`,
        message: 'You already have a referral code' 
      });
    }
    
    // Generate new code
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    user.referralCode = referralCode;
    await user.save();
    
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    res.json({ 
      success: true, 
      referralCode,
      referralLink: `${baseUrl}/signup?ref=${referralCode}`,
      message: 'Referral code generated successfully!' 
    });
  } catch (error) {
    logger.error('Generate referral code error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate referral code' });
  }
};
module.exports = exports;