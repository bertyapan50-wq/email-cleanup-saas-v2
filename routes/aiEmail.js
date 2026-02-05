const express = require('express');
const router = express.Router();
const { generateEmail, improveEmail } = require('../controllers/aiEmailController');
const auth = require('../middleware/auth');

// Generate email from prompt
router.post('/generate', auth, generateEmail);

// Improve existing email
router.post('/improve', auth, improveEmail);

module.exports = router;