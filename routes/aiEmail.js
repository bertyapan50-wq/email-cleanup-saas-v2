const express = require('express');
const router = express.Router();
const { generateEmail, improveEmail } = require('../controllers/aiEmailController');
const auth = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscription'); // ✅ DAGDAG

// Generate email from prompt
router.post('/generate', auth, requirePremium, generateEmail); // ✅ DAGDAG requirePremium

// Improve existing email
router.post('/improve', auth, requirePremium, improveEmail); // ✅ DAGDAG requirePremium

module.exports = router;