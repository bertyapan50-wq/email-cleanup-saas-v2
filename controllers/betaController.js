const BetaSignup = require('../models/BetaSignup');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../utils/logger');

exports.createBetaSignup = async (req, res) => {
  try {
    const { email, name, interestedFeatures, source } = req.body;
    const existingSignup = await BetaSignup.findOne({ email });
    if (existingSignup) return res.status(400).json({ success: false, message: 'Email already registered for beta' });

    const betaSignup = await BetaSignup.create({ email, name, interestedFeatures, source });
    await emailNotificationService.sendBetaConfirmation(email, name);

    res.status(201).json({ success: true, message: 'Beta signup successful! Check your email for confirmation.', betaSignup });
  } catch (error) {
    logger.error('Beta signup error:', error);
    res.status(500).json({ success: false, message: 'Beta signup failed' });
  }
};

exports.getBetaSignups = async (req, res) => {
  try {
    const signups = await BetaSignup.find().sort({ createdAt: -1 });
    res.json({ success: true, count: signups.length, signups });
  } catch (error) {
    logger.error('Fetch beta signups error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch signups' });
  }
};