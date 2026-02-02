const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const activityController = require('../controllers/activityController');

console.log('📊 Loading activity routes...');

// @desc    Get user's activity logs
// @route   GET /api/activity
// @access  Private
router.get('/', isAuthenticated, activityController.getActivityLogs);

// @desc    Get activity stats
// @route   GET /api/activity/stats
// @access  Private
router.get('/stats', isAuthenticated, activityController.getActivityStats);

// ✅ TEMPORARY: Inline function for testing
// @desc    Log a new activity
// @route   POST /api/activity/log
// @access  Private
router.post('/log', isAuthenticated, async (req, res) => {
  try {
    const { type, description, metadata } = req.body;
    const Activity = require('../models/Activity');
    
    const activity = await Activity.create({
      userId: req.user._id,
      action: type,
      description,
      details: metadata || {},
      timestamp: new Date()
    });
    
    console.log('✅ Activity logged:', activity);
    res.json({ success: true, activity });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    Clear old activity logs
// @route   DELETE /api/activity/clear
// @access  Private
router.delete('/clear', isAuthenticated, activityController.clearActivityLogs);

console.log('✅ Activity routes loaded');

module.exports = router;