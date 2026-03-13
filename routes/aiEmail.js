const express = require('express');
const router = express.Router();
const { generateEmail, improveEmail, broadcastEmails, previewBroadcast } = require('../controllers/aiEmailController');
const auth = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscription');

// Generate email from prompt
router.post('/generate', auth, requirePremium, generateEmail);

// Improve existing email
router.post('/improve', auth, requirePremium, improveEmail);

// ✅ Smart Broadcast — generate + send personalized bulk emails
router.post('/broadcast', auth, broadcastEmails);

// ✅ Preview personalized emails before sending
router.post('/broadcast/preview', auth, previewBroadcast);

module.exports = router;