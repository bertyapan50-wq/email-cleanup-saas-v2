// complete-setup.js - ONE SCRIPT TO CREATE EVERYTHING!
// Just run: node complete-setup.js

const fs = require('fs');
const path = require('path');

console.log('🚀 Starting complete setup...\n');

// Create all directories
const dirs = ['config', 'models', 'controllers', 'services', 'routes', 'middleware', 'utils'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ ${dir}/`);
  }
});

// All file contents
const files = {
  'server.js': `require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./config/database');
const logger = require('./utils/logger');

const app = express();
connectDB();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/beta', require('./routes/beta'));
app.use('/api/email', require('./routes/email'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/referral', require('./routes/referral'));
app.use('/api/webhook', require('./routes/webhook'));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => logger.info(\`Server running on port \${PORT}\`));`,

  'config/database.js': `const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = connectDB;`,

  'config/oauth.js': `const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const getAuthUrl = () => {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify'
    ],
    prompt: 'consent'
  });
};

module.exports = { oauth2Client, getAuthUrl };`,

  'config/stripe.js': `const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
module.exports = stripe;`,

  'utils/logger.js': `const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

module.exports = logger;`,

  'utils/validation.js': `const { validationResult } = require('express-validator');

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};`,

  'models/User.js': `const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, select: false },
  name: String,
  googleId: String,
  refreshToken: String,
  subscriptionTier: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
  subscriptionStatus: { type: String, enum: ['active', 'inactive', 'canceled', 'past_due'], default: 'inactive' },
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  emailQuotaUsed: { type: Number, default: 0 },
  emailQuotaLimit: { type: Number, default: 100 },
  lastQuotaReset: { type: Date, default: Date.now },
  isBetaUser: { type: Boolean, default: false },
  betaDiscountApplied: { type: Boolean, default: false },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  referralRewards: {
    monthsFree: { type: Number, default: 0 },
    yearsFree: { type: Number, default: 0 },
    lifetimePremium: { type: Boolean, default: false }
  },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);`,

  'models/BetaSignup.js': `const mongoose = require('mongoose');

const betaSignupSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  name: String,
  interestedFeatures: [String],
  source: String,
  status: { type: String, enum: ['pending', 'approved', 'converted'], default: 'pending' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BetaSignup', betaSignupSchema);`,

  'models/Subscription.js': `const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: String, enum: ['free', 'pro', 'enterprise'], required: true },
  provider: { type: String, enum: ['stripe', 'paypal', 'free'], default: 'free' },
  subscriptionId: String,
  status: { type: String, enum: ['active', 'inactive', 'canceled', 'past_due', 'trialing'], default: 'active' },
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  cancelAtPeriodEnd: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Subscription', subscriptionSchema);`,

  'models/EmailAction.js': `const mongoose = require('mongoose');

const emailActionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  emailId: String,
  action: { type: String, enum: ['delete', 'archive', 'label', 'mark_spam', 'unsubscribe', 'keep'], required: true },
  metadata: { sender: String, subject: String, date: Date, labels: [String], importance: Number },
  aiSuggestion: { action: String, confidence: Number, reasoning: String },
  userApproved: { type: Boolean, default: false },
  executed: { type: Boolean, default: false },
  executedAt: Date,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('EmailAction', emailActionSchema);`,

  'models/Referral.js': `const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  referredEmail: String,
  status: { type: String, enum: ['pending', 'completed', 'rewarded'], default: 'pending' },
  rewardType: { type: String, enum: ['month_free', 'year_free', 'lifetime_premium'] },
  rewardApplied: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Referral', referralSchema);`,

  'middleware/auth.js': `const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.status(401).json({ success: false, message: 'User not found' });
    
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Not authorized' });
  }
};`,

  'middleware/subscription.js': `exports.checkEmailQuota = async (req, res, next) => {
  try {
    const user = req.user;
    const now = new Date();
    const lastReset = new Date(user.lastQuotaReset);
    
    if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
      user.emailQuotaUsed = 0;
      user.lastQuotaReset = now;
      await user.save();
    }
    
    if (user.subscriptionTier === 'free' && user.emailQuotaUsed >= user.emailQuotaLimit) {
      return res.status(403).json({ success: false, message: 'Monthly email quota exceeded. Please upgrade your plan.' });
    }
    next();
  } catch (error) {
    next(error);
  }
};`,

  'middleware/rateLimiter.js': `const rateLimit = require('express-rate-limit');

exports.apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});

exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts, please try again later.'
});`,

  'controllers/authController.js': `const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const User = require('../models/User');
const { oauth2Client, getAuthUrl } = require('../config/oauth');
const logger = require('../utils/logger');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ success: false, message: 'User already exists' });

    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    const user = await User.create({ email, password, name, referralCode });
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: { id: user._id, email: user.email, name: user.name, subscriptionTier: user.subscriptionTier, referralCode: user.referralCode }
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
    res.json({ success: true, token, user: { id: user._id, email: user.email, name: user.name, subscriptionTier: user.subscriptionTier } });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

exports.getGoogleAuthUrl = (req, res) => res.json({ success: true, url: getAuthUrl() });

exports.googleCallback = async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    let user = await User.findOne({ email: data.email });
    if (!user) {
      const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      user = await User.create({ email: data.email, name: data.name, googleId: data.id, refreshToken: tokens.refresh_token, referralCode });
    } else {
      user.refreshToken = tokens.refresh_token || user.refreshToken;
      await user.save();
    }

    const token = generateToken(user._id);
    res.redirect(\`\${process.env.FRONTEND_URL}/auth/callback?token=\${token}\`);
  } catch (error) {
    logger.error('Google auth error:', error);
    res.redirect(\`\${process.env.FRONTEND_URL}/auth/error\`);
  }
};

exports.getProfile = async (req, res) => res.json({ success: true, user: req.user });`,

  'controllers/betaController.js': `const BetaSignup = require('../models/BetaSignup');
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
};`,

  'controllers/emailController.js': `const EmailAction = require('../models/EmailAction');
const User = require('../models/User');
const gmailService = require('../services/gmailService');
const aiService = require('../services/aiService');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../utils/logger');

exports.fetchAndAnalyzeEmails = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.refreshToken) return res.status(400).json({ success: false, message: 'Gmail not connected. Please authorize Gmail access.' });

    const emails = await gmailService.fetchEmails(user.refreshToken);
    const analyses = await aiService.batchAnalyzeEmails(emails);

    const suggestions = await Promise.all(
      emails.map(async (email, index) => {
        const analysis = analyses[index];
        return await EmailAction.create({
          userId: user._id,
          emailId: email.id,
          action: analysis.action,
          metadata: { sender: email.sender, subject: email.subject, date: email.date, labels: email.labels, importance: analysis.importance },
          aiSuggestion: { action: analysis.action, confidence: analysis.confidence, reasoning: analysis.reasoning }
        });
      })
    );

    res.json({
      success: true,
      analyzed: emails.length,
      suggestions: suggestions.map(s => ({ id: s._id, emailId: s.emailId, action: s.action, metadata: s.metadata, aiSuggestion: s.aiSuggestion }))
    });
  } catch (error) {
    logger.error('Email analysis error:', error);
    res.status(500).json({ success: false, message: 'Failed to analyze emails' });
  }
};

exports.executeCleanup = async (req, res) => {
  try {
    const { actionIds } = req.body;
    const user = await User.findById(req.user._id);
    const actions = await EmailAction.find({ _id: { $in: actionIds }, userId: user._id, executed: false });

    let executed = 0;
    for (const action of actions) {
      try {
        await gmailService.executeAction(user.refreshToken, action.emailId, action.action);
        action.executed = true;
        action.executedAt = new Date();
        action.userApproved = true;
        await action.save();
        executed++;
      } catch (error) {
        logger.error(\`Failed to execute action \${action._id}:\`, error);
      }
    }

    user.emailQuotaUsed += executed;
    await user.save();

    await emailNotificationService.sendCleanupSummary(user.email, {
      analyzed: actions.length,
      cleaned: executed,
      spaceSaved: \`\${executed * 0.1} MB\`
    });

    res.json({
      success: true,
      executed,
      failed: actions.length - executed,
      quotaRemaining: user.subscriptionTier === 'free' ? user.emailQuotaLimit - user.emailQuotaUsed : 'unlimited'
    });
  } catch (error) {
    logger.error('Cleanup execution error:', error);
    res.status(500).json({ success: false, message: 'Cleanup failed' });
  }
};

exports.getCleanupHistory = async (req, res) => {
  try {
    const history = await EmailAction.find({ userId: req.user._id, executed: true }).sort({ executedAt: -1 }).limit(100);
    res.json({ success: true, history });
  } catch (error) {
    logger.error('History fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch history' });
  }
};`,

  'controllers/subscriptionController.js': `const Subscription = require('../models/Subscription');
const paymentService = require('../services/paymentService');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../utils/logger');

exports.getSubscription = async (req, res) => {
  try {
    const user = req.user;
    const subscription = await Subscription.findOne({ userId: user._id });
    res.json({
      success: true,
      subscription: {
        tier: user.subscriptionTier,
        status: user.subscriptionStatus,
        quotaUsed: user.emailQuotaUsed,
        quotaLimit: user.emailQuotaLimit,
        isBeta: user.isBetaUser,
        details: subscription
      }
    });
  } catch (error) {
    logger.error('Get subscription error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subscription' });
  }
};

exports.createSubscription = async (req, res) => {
  try {
    const { plan, paymentMethod } = req.body;
    if (!['pro', 'enterprise'].includes(plan)) return res.status(400).json({ success: false, message: 'Invalid plan' });

    const result = await paymentService.createSubscription(req.user._id, plan, paymentMethod);
    await emailNotificationService.sendSubscriptionUpdate(req.user.email, 'active', plan);

    res.json({ success: true, message: 'Subscription created successfully', ...result });
  } catch (error) {
    logger.error('Create subscription error:', error);
    res.status(500).json({ success: false, message: 'Subscription creation failed' });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    await paymentService.cancelSubscription(req.user._id);
    await emailNotificationService.sendSubscriptionUpdate(req.user.email, 'canceled', req.user.subscriptionTier);
    res.json({ success: true, message: 'Subscription will be canceled at period end' });
  } catch (error) {
    logger.error('Cancel subscription error:', error);
    res.status(500).json({ success: false, message: 'Cancellation failed' });
  }
};`,

  'controllers/referralController.js': `const Referral = require('../models/Referral');
const User = require('../models/User');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../utils/logger');

exports.getReferralStats = async (req, res) => {
  try {
    const user = req.user;
    const referrals = await Referral.find({ referrerId: user._id });
    const completed = referrals.filter(r => r.status === 'completed').length;

    res.json({
      success: true,
      referralCode: user.referralCode,
      totalReferrals: referrals.length,
      completedReferrals: completed,
      pendingReferrals: referrals.filter(r => r.status === 'pending').length,
      rewards: { monthsFree: Math.floor(completed / 3), yearsFree: Math.floor(completed / 10), lifetimePremium: completed >= 25 },
      currentRewards: user.referralRewards
    });
  } catch (error) {
    logger.error('Get referral stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch referral stats' });
  }
};

exports.applyReferralCode = async (req, res) => {
  try {
    const { referralCode } = req.body;
    const user = req.user;

    if (user.referredBy) return res.status(400).json({ success: false, message: 'You have already used a referral code' });

    const referrer = await User.findOne({ referralCode });
    if (!referrer) return res.status(404).json({ success: false, message: 'Invalid referral code' });
    if (referrer._id.equals(user._id)) return res.status(400).json({ success: false, message: 'Cannot use your own referral code' });

    await Referral.create({ referrerId: referrer._id, referredUserId: user._id, referredEmail: user.email, status: 'completed' });
    user.referredBy = referrer._id;
    await user.save();

    await this.checkAndApplyRewards(referrer._id);
    res.json({ success: true, message: 'Referral code applied successfully!' });
  } catch (error) {
    logger.error('Apply referral error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply referral code' });
  }
};

exports.checkAndApplyRewards = async (userId) => {
  try {
    const referrals = await Referral.find({ referrerId: userId, status: 'completed' });
    const count = referrals.length;
    const user = await User.findById(userId);

    let rewardApplied = false;

    if (count >= 25 && !user.referralRewards.lifetimePremium) {
      user.referralRewards.lifetimePremium = true;
      user.subscriptionTier = 'pro';
      user.subscriptionStatus = 'active';
      await emailNotificationService.sendReferralReward(user.email, 'lifetime_premium');
      rewardApplied = true;
    } else if (count >= 10) {
      const yearRewards = Math.floor(count / 10) - user.referralRewards.yearsFree;
      if (yearRewards > 0) {
        user.referralRewards.yearsFree += yearRewards;
        await emailNotificationService.sendReferralReward(user.email, 'year_free');
        rewardApplied = true;
      }
    } else if (count >= 3) {
      const monthRewards = Math.floor(count / 3) - user.referralRewards.monthsFree;
      if (monthRewards > 0) {
        user.referralRewards.monthsFree += monthRewards;
        await emailNotificationService.sendReferralReward(user.email, 'month_free');
        rewardApplied = true;
      }
    }

    if (rewardApplied) await user.save();
    return rewardApplied;
  } catch (error) {
    logger.error('Check rewards error:', error);
  }
};`,

  'services/aiService.js': `const logger = require('../utils/logger');

class AIService {
  async analyzeEmail(emailMetadata) {
    try {
      const { sender, subject, snippet, date } = emailMetadata;
      let importance = 5, action = 'keep', confidence = 0.5, reasoning = '';

      const spamKeywords = ['winner', 'free money', 'claim now', 'urgent', 'act now'];
      const isSpam = spamKeywords.some(k => subject?.toLowerCase().includes(k) || snippet?.toLowerCase().includes(k));
      if (isSpam) { action = 'mark_spam'; importance = 1; confidence = 0.8; reasoning = 'Email contains spam indicators'; }

      const promoKeywords = ['unsubscribe', 'promotional', 'deal', 'sale', 'discount'];
      const isPromo = promoKeywords.some(k => snippet?.toLowerCase().includes(k));
      if (isPromo) { action = 'archive'; importance = 2; confidence = 0.7; reasoning = 'Promotional email that can be archived'; }

      const emailAge = (new Date() - new Date(date)) / (1000 * 60 * 60 * 24);
      if (emailAge > 180 && importance < 5) { action = 'archive'; confidence = 0.9; reasoning = 'Old email with low importance'; }

      const importantKeywords = ['important', 'urgent', 'action required', 'invoice', 'receipt'];
      const isImportant = importantKeywords.some(k => subject?.toLowerCase().includes(k));
      if (isImportant) { action = 'keep'; importance = 9; confidence = 0.8; reasoning = 'Email marked as important'; }

      return { action, confidence, importance, reasoning, metadata: { isSpam, isPromo, isImportant, ageInDays: Math.floor(emailAge) } };
    } catch (error) {
      logger.error('AI analysis error:', error);
      return { action: 'keep', confidence: 0, importance: 5, reasoning: 'Analysis failed, keeping email safe' };
    }
  }

  async batchAnalyzeEmails(emails) {
    return Promise.all(emails.map(email => this.analyzeEmail(email)));
  }
}

module.exports = new AIService();`,

  'services/gmailService.js': `const { google } = require('googleapis');
const { oauth2Client } = require('../config/oauth');
const logger = require('../utils/logger');

class GmailService {
  async getGmailClient(refreshToken) {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  async fetchEmails(refreshToken, maxResults = 50) {
    try {
      const gmail = await this.getGmailClient(refreshToken);
      const response = await gmail.users.messages.list({ userId: 'me', maxResults, q: '-in:trash -in:spam' });
      if (!response.data.messages) return [];

      const emails = await Promise.all(
        response.data.messages.slice(0, 20).map(async (message) => {
          const email = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
          const headers = email.data.payload.headers;
          return {
            id: email.data.id,
            sender: headers.find(h => h.name === 'From')?.value || '',
            subject: headers.find(h => h.name === 'Subject')?.value || '',
            date: headers.find(h => h.name === 'Date')?.value || '',
            snippet: email.data.snippet,
            labels: email.data.labelIds || []
          };
        })
      );

      return emails;
    } catch (error) {
      logger.error('Gmail fetch error:', error);
      throw error;
    }
  }

  async executeAction(refreshToken, emailId, action) {
    try {
      const gmail = await this.getGmailClient(refreshToken);
      switch (action) {
        case 'delete': await gmail.users.messages.trash({ userId: 'me', id: emailId }); break;
        case 'archive': await gmail.users.messages.modify({ userId: 'me', id: emailId, requestBody: { removeLabelIds: ['INBOX'] } }); break;
        case 'mark_spam': await gmail.users.messages.modify({ userId: 'me', id: emailId, requestBody: { addLabelIds: ['SPAM'] } }); break;
      }
      return { success: true };
    } catch (error) {
      logger.error('Gmail action error:', error);
      throw error;
    }
  }
}

module.exports = new GmailService();`,

  'services/paymentService.js': `const stripe = require('../config/stripe');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');

class PaymentService {
  async createStripeCustomer(user) {
    try {
      const customer = await stripe.customers.create({ email: user.email, name: user.name, metadata: { userId: user._id.toString() } });
      user.stripeCustomerId = customer.id;
      await user.save();
      return customer;
    } catch (error) {
      logger.error('Stripe customer creation error:', error);
      throw error;
    }
  }

  async createSubscription(userId, plan, paymentMethod) {
    try {
      const user = await User.findById(userId);
      if (!user.stripeCustomerId) await this.createStripeCustomer(user);

      const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_ID_PRO : process.env.STRIPE_PRICE_ID_ENTERPRISE;
      const subscriptionData = { customer: user.stripeCustomerId, items: [{ price: priceId }], payment_behavior: 'default_incomplete', expand: ['latest_invoice.payment_intent'] };

      if (user.isBetaUser && !user.betaDiscountApplied) {
        const coupon = await stripe.coupons.create({ percent_off: 50, duration: 'forever', name: 'Beta User Discount' });
        subscriptionData.coupon = coupon.id;
        user.betaDiscountApplied = true;
      }

      const subscription = await stripe.subscriptions.create(subscriptionData);
      user.subscriptionTier = plan;
      user.subscriptionStatus = 'active';
      user.stripeSubscriptionId = subscription.id;
      user.emailQuotaLimit = 999999;
      await user.save();

      await Subscription.create({
        userId, plan, provider: 'stripe', subscriptionId: subscription.id, status: 'active',
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000)
      });

      return { subscriptionId: subscription.id, clientSecret: subscription.latest_invoice.payment_intent.client_secret };
    } catch (error) {
      logger.error('Subscription creation error:', error);
      throw error;
    }
  }

  async cancelSubscription(userId) {
    try {
      const user = await User.findById(userId);
      if (!user.stripeSubscriptionId) throw new Error('No active subscription found');

      const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true });
      await Subscription.findOneAndUpdate({ userId, subscriptionId: user.stripeSubscriptionId }, { cancelAtPeriodEnd: true, updatedAt: new Date() });
      return subscription;
    } catch (error) {
      logger.error('Subscription cancellation error:', error);
      throw error;
    }
  }

  async handleWebhook(event) {
    try {
      switch (event.type) {
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await this.handleSubscriptionChange(event.data.object);
          break;
        case 'invoice.payment_failed':
          await this.handlePaymentFailure(event.data.object);
          break;
        default:
          logger.info(\`Unhandled webhook event: \${event.type}\`);
      }
    } catch (error) {
      logger.error('Webhook handling error:', error);
      throw error;
    }
  }

  async handleSubscriptionChange(subscription) {
    const user = await User.findOne({ stripeCustomerId: subscription.customer });
    if (user) {
      user.subscriptionStatus = subscription.status;
      await user.save();
      await Subscription.findOneAndUpdate({ subscriptionId: subscription.id }, { status: subscription.status, currentPeriodEnd: new Date(subscription.current_period_end * 1000), updatedAt: new Date() });
    }
  }

  async handlePaymentFailure(invoice) {
    const user = await User.findOne({ stripeCustomerId: invoice.customer });
    if (user) {
      user.subscriptionStatus = 'past_due';
      await user.save();
    }
  }
}

module.exports = new PaymentService();`,

  'services/emailNotificationService.js': `const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailNotificationService {
  constructor() {
    this.transporter = nodemailer.createTransporter({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
    });
  }

  async sendBetaConfirmation(email, name) {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Welcome to Email Cleanup Beta! 🎉',
        html: \`<h1>Welcome \${name}!</h1><p>Thank you for signing up for our beta program.</p><p>You'll get early access to our AI-powered email cleanup platform and a special 50% discount when we launch!</p><p>We'll keep you updated on our progress.</p>\`
      });
      logger.info(\`Beta confirmation sent to \${email}\`);
    } catch (error) {
      logger.error('Email send error:', error);
    }
  }

  async sendSubscriptionUpdate(email, status, plan) {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Subscription Update',
        html: \`<h1>Subscription Update</h1><p>Your subscription status has been updated to: \${status}</p><p>Plan: \${plan}</p>\`
      });
    } catch (error) {
      logger.error('Email send error:', error);
    }
  }

  async sendReferralReward(email, rewardType) {
    const rewards = { month_free: '1 month free', year_free: '1 year free', lifetime_premium: 'Lifetime Premium' };
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: '🎁 Referral Reward Unlocked!',
        html: \`<h1>Congratulations!</h1><p>You've unlocked a reward: \${rewards[rewardType]}</p><p>Thank you for spreading the word!</p>\`
      });
    } catch (error) {
      logger.error('Email send error:', error);
    }
  }

  async sendCleanupSummary(email, summary) {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Email Cleanup Summary',
        html: \`<h1>Cleanup Summary</h1><p>Emails analyzed: \${summary.analyzed}</p><p>Emails cleaned: \${summary.cleaned}</p><p>Space saved: \${summary.spaceSaved}</p>\`
      });
    } catch (error) {
      logger.error('Email send error:', error);
    }
  }
}

module.exports = new EmailNotificationService();`,

  'routes/auth.js': `const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/validation');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/register', authLimiter, [body('email').isEmail().normalizeEmail(), body('password').isLength({ min: 8 }), body('name').trim().notEmpty()], validate, authController.register);
router.post('/login', authLimiter, authController.login);
router.get('/google', authController.getGoogleAuthUrl);
router.get('/google/callback', authController.googleCallback);
router.get('/profile', protect, authController.getProfile);

module.exports = router;`,

  'routes/beta.js': `const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const betaController = require('../controllers/betaController');
const { validate } = require('../utils/validation');
const { apiLimiter } = require('../middleware/rateLimiter');

router.post('/', apiLimiter, [body('email').isEmail().normalizeEmail(), body('name').trim().notEmpty()], validate, betaController.createBetaSignup);
router.get('/', betaController.getBetaSignups);

module.exports = router;`,

  'routes/email.js': `const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const { protect } = require('../middleware/auth');
const { checkEmailQuota } = require('../middleware/subscription');

router.get('/analyze', protect, checkEmailQuota, emailController.fetchAndAnalyzeEmails);
router.post('/cleanup', protect, emailController.executeCleanup);
router.get('/history', protect, emailController.getCleanupHistory);

module.exports = router;`,

  'routes/subscription.js': `const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { protect } = require('../middleware/auth');

router.get('/', protect, subscriptionController.getSubscription);
router.post('/create', protect, subscriptionController.createSubscription);
router.post('/cancel', protect, subscriptionController.cancelSubscription);

module.exports = router;`,

  'routes/referral.js': `const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const referralController = require('../controllers/referralController');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/validation');

router.get('/stats', protect, referralController.getReferralStats);
router.post('/apply', protect, [body('referralCode').trim().notEmpty()], validate, referralController.applyReferralCode);

module.exports = router;`,

  'routes/webhook.js': `const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const paymentService = require('../services/paymentService');
const logger = require('../utils/logger');

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    await paymentService.handleWebhook(event);
    res.json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook error:', error);
    res.status(400).send(\`Webhook Error: \${error.message}\`);
  }
});

router.post('/paypal', async (req, res) => {
  try {
    logger.info('PayPal webhook received:', req.body);
    res.json({ received: true });
  } catch (error) {
    logger.error('PayPal webhook error:', error);
    res.status(400).send(\`Webhook Error: \${error.message}\`);
  }
});

module.exports = router;`,

  '.gitignore': `node_modules/
.env
*.log
.DS_Store`,

  '.env.example': `NODE_ENV=development
PORT=5000
MONGODB_URI=your_mongodb_uri
JWT_SECRET=your_jwt_secret
JWT_EXPIRE=7d
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret
STRIPE_PRICE_ID_PRO=your_pro_price_id
STRIPE_PRICE_ID_ENTERPRISE=your_enterprise_price_id
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
FRONTEND_URL=http://localhost:3000`
};

// Write all files
console.log('\n📝 Creating files...\n');
Object.entries(files).forEach(([filepath, content]) => {
  fs.writeFileSync(filepath, content);
  console.log(`✅ ${filepath}`);
});

console.log('\n🎉 COMPLETE SETUP DONE!\n');
console.log('Next steps:');
console.log('1. copy .env.example .env');
console.log('2. Edit .env with your credentials');
console.log('3. npm run dev\n');