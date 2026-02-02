const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const betaController = require('../controllers/betaController');
const { validate } = require('../utils/validation');
const { apiLimiter } = require('../middleware/rateLimiter');

router.post('/', apiLimiter, [body('email').isEmail().normalizeEmail(), body('name').trim().notEmpty()], validate, betaController.createBetaSignup);
router.get('/', betaController.getBetaSignups);

module.exports = router;