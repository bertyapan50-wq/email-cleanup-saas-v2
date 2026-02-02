const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const referralController = require('../controllers/referralController');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/validation');
const Referral = require('../models/Referral'); // ✅ ADD THIS
const logger = require('../utils/logger'); // ✅ ADD THIS

// ✅ NEW: Generate referral code
router.post('/generate', protect, referralController.generateReferralCode);

// NEW ROUTES - Sustainable Referral System
router.get('/info', protect, referralController.getReferralInfo);
router.post('/signup', referralController.trackReferralSignup);
router.post('/activate', referralController.activateReferral);
router.post('/claim/:referralId', protect, referralController.claimReward);

// OLD ROUTES - Kept for backward compatibility
router.get('/stats', protect, referralController.getReferralStats);
router.post('/apply', protect, [
  body('referralCode').trim().notEmpty()
], validate, referralController.applyReferralCode);

// ✅ NEW: Cleanup duplicate referrals
router.post('/cleanup-duplicates', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get all referrals
    const referrals = await Referral.find({ referrerId: userId });
    
    // Group by email
    const emailGroups = {};
    referrals.forEach(ref => {
      const email = ref.referredEmail || 'N/A';
      if (!emailGroups[email]) emailGroups[email] = [];
      emailGroups[email].push(ref);
    });
    
    let removed = 0;
    
    // For each email, keep only the best one
    for (const [email, refs] of Object.entries(emailGroups)) {
      if (refs.length > 1) {
        // Sort: active first, then by date
        refs.sort((a, b) => {
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (a.status !== 'active' && b.status === 'active') return 1;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
        
        // Keep first, delete rest
        const toDelete = refs.slice(1).map(r => r._id);
        await Referral.deleteMany({ _id: { $in: toDelete } });
        removed += toDelete.length;
      }
    }
    
    // Remove N/A entries
    const naRemoved = await Referral.deleteMany({
      referrerId: userId,
      referredEmail: { $in: [null, '', 'N/A'] }
    });
    
    removed += naRemoved.deletedCount;
    
    res.json({
      success: true,
      message: `Cleaned up ${removed} duplicate entries`,
      removed
    });
    
  } catch (error) {
    logger.error('Cleanup error:', error);
    res.status(500).json({ error: 'Failed to cleanup duplicates' });
  }
});

module.exports = router;