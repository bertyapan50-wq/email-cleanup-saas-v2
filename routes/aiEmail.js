const express = require('express');
const router = express.Router();
const { generateEmail, improveEmail, broadcastEmails, previewBroadcast } = require('../controllers/aiEmailController');
const auth = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscription'); // ✅ DAGDAG

// Generate email from prompt
router.post('/generate', auth, requirePremium, generateEmail); // ✅ DAGDAG requirePremium

// Improve existing email
router.post('/improve', auth, requirePremium, improveEmail); // ✅ DAGDAG requirePremium

// ✅ NEW: Smart Broadcast — generate + send personalized bulk emails
router.post('/broadcast', auth, broadcastEmails);

// ✅ NEW: Preview personalized emails before sending
router.post('/broadcast/preview', auth, previewBroadcast);

module.exports = router;