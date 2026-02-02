// Backend API for Early Bird Spots Tracking
// File: routes/publicRoutes.js or routes/earlyBird.js

const express = require('express');
const router = express.Router();

// In-memory storage (use Redis or MongoDB in production)
let earlyBirdData = {
  totalSpots: 1000,
  spotsLeft: 847,
  lastReset: new Date(),
  signupsToday: 153
};

// Helper: Reset daily at midnight
const checkAndResetDaily = () => {
  const now = new Date();
  const lastReset = new Date(earlyBirdData.lastReset);
  
  // Check if it's a new day
  if (now.getDate() !== lastReset.getDate() || 
      now.getMonth() !== lastReset.getMonth() || 
      now.getFullYear() !== lastReset.getFullYear()) {
    
    // Reset spots for new day
    earlyBirdData = {
      totalSpots: 1000,
      spotsLeft: Math.max(200, earlyBirdData.spotsLeft), // Minimum 200 spots daily
      lastReset: now,
      signupsToday: 0
    };
  }
};

// GET: Get current early bird spots count
router.get('/early-bird-spots', (req, res) => {
  try {
    checkAndResetDaily();
    
    res.json({
      success: true,
      spotsLeft: earlyBirdData.spotsLeft,
      totalSpots: earlyBirdData.totalSpots,
      percentage: Math.round((earlyBirdData.spotsLeft / earlyBirdData.totalSpots) * 100),
      endsAt: getEndOfDay()
    });
  } catch (error) {
    console.error('Error fetching early bird spots:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch early bird data'
    });
  }
});

// POST: Claim early bird spot (called on successful signup)
router.post('/claim-early-bird-spot', (req, res) => {
  try {
    checkAndResetDaily();
    
    if (earlyBirdData.spotsLeft <= 0) {
      return res.json({
        success: false,
        message: 'Early bird promotion has ended',
        discount: 0
      });
    }
    
    // Decrease spot count
    earlyBirdData.spotsLeft--;
    earlyBirdData.signupsToday++;
    
    res.json({
      success: true,
      message: 'Early bird discount applied!',
      discount: 0.30, // 30% off
      spotsLeft: earlyBirdData.spotsLeft
    });
  } catch (error) {
    console.error('Error claiming early bird spot:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to claim early bird spot'
    });
  }
});

// GET: Admin endpoint to check stats
router.get('/admin/early-bird-stats', (req, res) => {
  // TODO: Add authentication middleware
  checkAndResetDaily();
  
  res.json({
    success: true,
    stats: {
      ...earlyBirdData,
      conversionRate: ((earlyBirdData.signupsToday / (earlyBirdData.totalSpots - earlyBirdData.spotsLeft)) * 100).toFixed(2) + '%'
    }
  });
});

// Helper: Get end of current day
const getEndOfDay = () => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
};

module.exports = router;

/* 
==========================================
USAGE IN MAIN APP (server.js or app.js):
==========================================

const earlyBirdRoutes = require('./routes/publicRoutes');
app.use('/api/public', earlyBirdRoutes);

==========================================
PRODUCTION VERSION (with MongoDB):
==========================================

const EarlyBird = require('./models/EarlyBird');

router.get('/early-bird-spots', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    let earlyBird = await EarlyBird.findOne({ date: today });
    
    if (!earlyBird) {
      earlyBird = new EarlyBird({
        date: today,
        totalSpots: 1000,
        spotsLeft: 1000,
        signups: []
      });
      await earlyBird.save();
    }
    
    res.json({
      success: true,
      spotsLeft: earlyBird.spotsLeft,
      totalSpots: earlyBird.totalSpots
    });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

==========================================
MONGODB SCHEMA (models/EarlyBird.js):
==========================================

const mongoose = require('mongoose');

const earlyBirdSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // YYYY-MM-DD
  totalSpots: { type: Number, default: 1000 },
  spotsLeft: { type: Number, default: 1000 },
  signups: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
    discount: { type: Number, default: 0.30 }
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('EarlyBird', earlyBirdSchema);

*/