const express = require('express');
const router = express.Router();
const { generateEmail, improveEmail, broadcastEmails, previewBroadcast } = require('../controllers/aiEmailController');
const auth = require('../middleware/auth');

// Generate email from prompt
router.post('/generate', auth, generateEmail);

// Improve existing email
router.post('/improve', auth, improveEmail);

// ✅ NEW: Smart Broadcast — generate + send personalized bulk emails
router.post('/broadcast', auth, broadcastEmails);

// ✅ NEW: Preview personalized emails before sending
router.post('/broadcast/preview', auth, previewBroadcast);

module.exports = router;