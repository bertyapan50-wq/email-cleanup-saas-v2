const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// ✅ Start Free Trial
router.post('/start-trial', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
const user = await User.findById(userId);

    
    // ✅ FIXED: Check if trial is ACTIVE or EXPIRED
if (user.trialUsed) {
  // Check if trial is still active
  if (user.isTrialActive()) {
    return res.json({ 
      success: false, 
      message: 'You already have an active trial!' 
    });
  }
  
  // Trial was used and expired
  return res.json({ 
    success: false, 
    message: 'Your free trial has ended. Upgrade to Premium to continue!' 
  });
}
    
    // Check if already premium
    if (user.subscriptionTier === 'premium' || user.subscriptionTier === 'pro') {
      return res.json({ 
        success: false, 
        message: 'You already have a premium subscription' 
      });
    }
    
    // Start trial
    await user.startFreeTrial();
    
    console.log(`✅ Trial started for user: ${user.email}`);
    
    res.json({ 
      success: true, 
      message: '🎉 Your 7-day free trial has started!',
      trialEndDate: user.trialEndDate,
      user: {
        email: user.email,
        trialEndDate: user.trialEndDate,
        isTrialActive: user.isTrialActive()
      }
    });
  } catch (error) {
    console.error('Trial start error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ✅ Check Trial Status
router.get('/trial-status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    res.json({
      success: true,
      trial: {
        used: user.trialUsed,
        active: user.isTrialActive(),
        startDate: user.trialStartDate,
        endDate: user.trialEndDate,
        daysLeft: user.isTrialActive() 
          ? Math.ceil((new Date(user.trialEndDate) - new Date()) / (1000 * 60 * 60 * 24))
          : 0
      },
      freeCleanups: {
        remaining: user.freeCleanupCount,
        total: user.totalCleanupsUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Cancel Trial (optional - for testing)
router.post('/cancel-trial', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    user.trialEndDate = new Date(); // End trial now
    await user.save();
    
    res.json({ 
      success: true, 
      message: 'Trial cancelled' 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ NEW: Reset Trial (For Testing/Admin)
router.post('/reset-trial', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    // Reset trial
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 7); // 7 days from now
    
    user.trialStartDate = now;
    user.trialEndDate = trialEnd;
    user.trialUsed = false;
    user.freeCleanupCount = 3;
    
    await user.save();
    
    console.log(`✅ Trial RESET for user: ${user.email}`);
    console.log(`   Start: ${now}`);
    console.log(`   End: ${trialEnd}`);
    
    res.json({ 
      success: true, 
      message: '🎉 Trial has been reset! You now have 7 days of free trial.',
      trial: {
        startDate: user.trialStartDate,
        endDate: user.trialEndDate,
        daysLeft: 7,
        active: true
      },
      freeCleanupCount: user.freeCleanupCount
    });
  } catch (error) {
    console.error('Trial reset error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
// ✅ TEST ONLY: Expire trial immediately
router.post('/expire-trial', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Set trial to expired (yesterday)
    user.trialEndDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    user.freeCleanupCount = 0; // Also exhaust quota
    await user.save();
    
    console.log(`⏰ Trial EXPIRED for testing: ${user.email}`);
    console.log(`   End date: ${user.trialEndDate}`);
    
    res.json({ 
      success: true, 
      message: '⏰ Trial expired for testing',
      trialEndDate: user.trialEndDate,
      isActive: user.isTrialActive()
    });
  } catch (error) {
    console.error('Trial expire error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
module.exports = router;