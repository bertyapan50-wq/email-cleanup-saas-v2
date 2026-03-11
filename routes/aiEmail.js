const express = require('express');
const router = express.Router();
<<<<<<< HEAD
const { generateEmail, improveEmail } = require('../controllers/aiEmailController');
const { protect } = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscription');

router.post('/generate', protect, requirePremium, generateEmail);
router.post('/improve', protect, requirePremium, improveEmail);
=======
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
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f

module.exports = router;