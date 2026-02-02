const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const User = require('../models/User');
const Referral = require('../models/Referral'); 
const ConnectedAccount = require('../models/ConnectedAccount'); // ✅ ADDED
const { oauth2Client, getAuthUrl } = require('../config/oauth');
const logger = require('../utils/logger');

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ success: false, message: 'User already exists' });

    const referralCode = await User.generateUniqueReferralCode();

    const user = await User.create({ email, password, name, referralCode });

    // ✅ UPDATE PENDING REFERRAL WITH USER ID
    await Referral.findOneAndUpdate(
      { referredEmail: email, status: 'pending', referredUserId: null },
      { referredUserId: user._id, signedUpAt: new Date() }
    );

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: { 
        id: user._id,
        email: user.email,
        name: user.name,
        subscriptionTier: user.subscriptionTier,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        trialEndDate: user.trialEndDate,
        trialUsed: user.trialUsed,
        freeCleanupCount: user.freeCleanupCount,
        totalCleanupsUsed: user.totalCleanupsUsed
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({ 
      success: true, 
      token, 
      user: { 
        id: user._id,
        email: user.email,
        name: user.name,
        subscriptionTier: user.subscriptionTier,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        trialEndDate: user.trialEndDate,
        trialUsed: user.trialUsed,
        freeCleanupCount: user.freeCleanupCount,
        totalCleanupsUsed: user.totalCleanupsUsed
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

exports.getGoogleAuthUrl = (req, res) =>
  res.json({ success: true, url: getAuthUrl() });

// ✅ UPDATED GOOGLE CALLBACK - Now saves ConnectedAccount
exports.googleCallback = async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    let user = await User.findOne({ email: data.email });
    let isNewUser = false;

    if (!user) {
      const referralCode = await User.generateUniqueReferralCode();
user.referralCode = referralCode;

      user = await User.create({ 
        email: data.email,
        name: data.name,
        googleId: data.id,
        refreshToken: tokens.refresh_token,
        referralCode,
        googleTokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          scope: tokens.scope,
          token_type: tokens.token_type,
          expiry_date: tokens.expiry_date
        }
      });

      // ✅ UPDATE PENDING REFERRAL
      await Referral.findOneAndUpdate(
        { referredEmail: data.email, status: 'pending', referredUserId: null },
        { referredUserId: user._id, signedUpAt: new Date() }
      );
    } else {
      user.refreshToken = tokens.refresh_token || user.refreshToken;
      user.googleTokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || user.googleTokens?.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date
      };
      await user.save();
    }

    // ✅ NEW: Save or Update ConnectedAccount
    try {
      let connectedAccount = await ConnectedAccount.findOne({
        userId: user._id,
        email: data.email
      });

      if (connectedAccount) {
        // Update existing account
        connectedAccount.accessToken = tokens.access_token;
        connectedAccount.refreshToken = tokens.refresh_token;
        connectedAccount.tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
        connectedAccount.status = 'connected';
        connectedAccount.lastSync = new Date();
        connectedAccount.lastUsed = new Date();
        
        await connectedAccount.save();
        logger.info(`✅ Updated connected account: ${data.email}`);
      } else {
        // Check if user has any accounts (first account is primary)
        const accountCount = await ConnectedAccount.countDocuments({ userId: user._id });
        const isPrimary = accountCount === 0;

        // Create new connected account
        connectedAccount = await ConnectedAccount.create({
          userId: user._id,
          provider: 'gmail',
          email: data.email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          isPrimary,
          status: 'connected',
          permissions: ['read', 'send', 'modify'],
          lastSync: new Date(),
          settings: {
            autoSync: true,
            syncInterval: 300000, // 5 minutes
            syncLabels: true,
            syncAttachments: false
          }
        });

        logger.info(`✅ Created new connected account: ${data.email} | Primary: ${isPrimary}`);
      }
    } catch (accountError) {
      logger.error('❌ Error saving connected account:', accountError);
      // Don't fail the login if this fails
    }

    const token = generateToken(user._id);
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
  } catch (error) {
    logger.error('Google auth error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/auth/error`);
  }
};

exports.getProfile = async (req, res) => {
  try {
    res.json({ 
      success: true, 
      user: {
        id: req.user._id,
        email: req.user.email,
        name: req.user.name,
        subscriptionTier: req.user.subscriptionTier,
        subscriptionStatus: req.user.subscriptionStatus,
        referralCode: req.user.referralCode,
        referredBy: req.user.referredBy,
        trialEndDate: req.user.trialEndDate,
        trialUsed: req.user.trialUsed,
        freeCleanupCount: req.user.freeCleanupCount,
        totalCleanupsUsed: req.user.totalCleanupsUsed
      }
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
};

exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user)
      return res.status(404).json({ success: false, message: 'User not found' });

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        subscriptionTier: user.subscriptionTier,
        subscriptionStatus: user.subscriptionStatus,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        trialEndDate: user.trialEndDate,
        trialUsed: user.trialUsed,
        freeCleanupCount: user.freeCleanupCount,
        totalCleanupsUsed: user.totalCleanupsUsed,
        emailQuotaUsed: user.emailQuotaUsed,
        emailQuotaLimit: user.emailQuotaLimit,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user data' });
  }
};
// ==================== ADD THESE NEW FUNCTIONS ====================
// (Add sa dulo ng authController.js BEFORE module.exports or after existing functions)

// ✅ NEW: Get OAuth URL for connecting additional account
exports.getConnectGoogleUrl = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.settings.basic'
      ],
      prompt: 'consent',
      state: JSON.stringify({ 
        action: 'connect',
        userId: req.user._id.toString()
      })
    });

    logger.info(`Generated connect URL for user: ${req.user.email}`);
    
    res.json({ success: true, url: authUrl });
  } catch (error) {
    logger.error('Error generating connect URL:', error);
    res.status(500).json({ success: false, message: 'Failed to generate connect URL' });
  }
};

// ✅ NEW: Handle OAuth callback for additional accounts
exports.googleConnectCallback = async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings/connected-accounts?error=no_code`);
    }

    // Parse state
    let stateData = { action: 'connect' };
    try {
      if (state) {
        stateData = JSON.parse(state);
      }
    } catch (e) {
      logger.warn('Invalid state parameter:', state);
    }

    if (!stateData.userId) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings/connected-accounts?error=missing_user`);
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: googleUser } = await oauth2.userinfo.get();

    logger.info(`Connecting account: ${googleUser.email} for user: ${stateData.userId}`);

    // Verify user exists
    const user = await User.findById(stateData.userId);
    if (!user) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings/connected-accounts?error=user_not_found`);
    }

    // Check if account already connected
    const existingAccount = await ConnectedAccount.findOne({
      userId: user._id,
      email: googleUser.email
    });

    if (existingAccount) {
      logger.info(`Account already connected: ${googleUser.email}`);
      return res.redirect(`${process.env.FRONTEND_URL}/settings/connected-accounts?error=already_connected`);
    }

    // Create new connected account (NOT primary)
    const connectedAccount = await ConnectedAccount.create({
      userId: user._id,
      provider: 'gmail',
      email: googleUser.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      isPrimary: false, // Additional accounts are never primary
      status: 'connected',
      permissions: ['read', 'send', 'modify'],
      lastSync: new Date(),
      settings: {
        autoSync: true,
        syncInterval: 300000,
        syncLabels: true,
        syncAttachments: false
      }
    });

    logger.info(`✅ Successfully connected additional account: ${googleUser.email}`);

    return res.redirect(`${process.env.FRONTEND_URL}/settings/connected-accounts?success=true&email=${encodeURIComponent(googleUser.email)}`);

  } catch (error) {
    logger.error('Error connecting Google account:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/settings/connected-accounts?error=${encodeURIComponent(error.message)}`);
  }
};