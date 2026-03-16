const express = require('express');
const router = express.Router();
const { generateEmail, improveEmail, broadcastEmails, previewBroadcast } = require('../controllers/aiEmailController');
const auth = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscription');

router.post('/generate', auth, requirePremium, generateEmail);
router.post('/improve', auth, requirePremium, improveEmail);

router.post('/broadcast', auth, (req, res, next) => {
  console.log('👤 USER:', req.user?.email || 'NULL');
  console.log('🔑 REFRESH TOKEN:', req.user?.googleTokens?.refresh_token ? 'EXISTS' : 'MISSING');
  console.log('🔑 ACCESS TOKEN:', req.user?.googleTokens?.access_token ? 'EXISTS' : 'MISSING');
  console.log('📦 FULL TOKENS:', JSON.stringify(req.user?.googleTokens));
  next();
}, broadcastEmails);

router.post('/broadcast/preview', auth, previewBroadcast);

module.exports = router;