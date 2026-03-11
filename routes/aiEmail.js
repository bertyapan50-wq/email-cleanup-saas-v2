const express = require('express');
const router = express.Router();
const { generateEmail, improveEmail } = require('../controllers/aiEmailController');
const { protect } = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscription');

router.post('/generate', protect, requirePremium, generateEmail);
router.post('/improve', protect, requirePremium, improveEmail);

module.exports = router;