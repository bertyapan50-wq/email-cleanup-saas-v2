const express = require('express');
const router = express.Router();
const { generateEmail, improveEmail, broadcastEmails, previewBroadcast } = require('../controllers/aiEmailController');
const auth = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscription');

router.post('/generate', auth, requirePremium, generateEmail);
router.post('/improve', auth, requirePremium, improveEmail);

// ✅ Debug middleware added here
router.post('/broadcast', auth, (req, res, next) => {
  console.log('👤 USER:', req.user?.email || 'NULL');
  console.log('🔑 REFRESH TOKEN:', req.user?.googleTokens?.refresh_token ? 'EXISTS' : 'MISSING');
  next();
}, broadcastEmails);

router.post('/broadcast/preview', auth, previewBroadcast);

module.exports = router;