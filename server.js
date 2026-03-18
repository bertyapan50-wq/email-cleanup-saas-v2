console.log("🔥 SERVER.JS FILE LOADED");

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const passport = require('./config/passport');
const cron = require('node-cron');
const connectDB = require('./config/database');
const logger = require('./utils/logger');
const path = require('path');
const mongoose = require('mongoose');

const app = express();

// =====================
// Connect to database
// =====================
connectDB();

// =====================
// 🔥 PRE-LOAD ALL MODELS (CRITICAL - MUST BE AFTER DB CONNECTION!)
// =====================
console.log('📦 Pre-loading Mongoose models...');

// Load all models BEFORE routes
require('./models/User');
require('./models/Task');
require('./models/UserWorkPattern');
require('./models/Schedule');
require('./models/ScheduleLog');
require('./models/UserPreferences');
require('./models/Category');
require('./models/Referral');
require('./models/Subscription');
require('./models/BetaSignup');
require('./models/ConnectedAccount');
require('./models/EmailAction');
require('./models/SenderAnalytics');
require('./models/Activity'); // ✅ NEW: Activity logging model
require('./models/AutoRule'); // ✅ NEW: Auto Actions rules model

// Verify models loaded
console.log('✅ Models loaded:', Object.keys(mongoose.models).join(', '));

// =====================
// Middleware
// =====================
app.use(helmet());

app.use(cors({
 origin: ['http://localhost:3000', 'https://gmail-cleanup-ai.netlify.app', 'https://inboxdetox.netlify.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
const { apiLimiter, authLimiter } = require('./middleware/rateLimiter');
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// =====================
// Session (before Passport)
// =====================
const MongoStore = require('connect-mongo').default ?? require('connect-mongo');





app.use(session({
  secret: process.env.SESSION_SECRET || 'gmail_cleanup_secret_key',
  resave: false,
  saveUninitialized: false,
  name: 'connect.sid',
  
  // ✅ CORRECT syntax for connect-mongo v6
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600
  }),
  
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'none',
    path: '/'
  },
  
  proxy: true
}));

// =====================
// Passport (after session)
// =====================
app.use(passport.initialize());
app.use(passport.session());
 
app.use((req, res, next) => {
  logger.info(`➡️ ${req.method} ${req.originalUrl}`);
  logger.info(`🔐 Session ID: ${req.sessionID || 'none'}`);
  logger.info(`👤 User: ${req.user?.email || 'not authenticated'}`);
  next();
});

// =====================
// Routes
// =====================
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/beta', require('./routes/beta'));
app.use('/api/email', apiLimiter, require('./routes/email'));  // ← DAGDAG MO ITO!
app.use('/api/filters', require('./routes/filters'));
app.use('/api/labels', require('./routes/labels'));
app.use('/api/followups', require('./routes/followups'));
app.use('/api/settings', require('./routes/setting'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/trial', require('./routes/trial'));
app.use('/api/referral', require('./routes/referral'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/paymongo/webhook', require('./routes/paymongoWebhook'));
app.use('/api/user', require('./routes/profile'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/planning', require('./routes/planning'));
app.use('/api/activity', require('./routes/activity')); // ✅ NEW: Activity logging routes
app.use('/api/rules', require('./routes/rules')); // ✅ NEW: Auto Actions rules
app.use('/api/ai-email', require('./routes/aiEmail'));
app.use('/api/ai-assistant', require('./routes/aiAssistant'));

app.get('/api/lemonsqueezy/ping', (req, res) => {
  return res.json({ ok: true });
});

try {
  app.use('/api/lemonsqueezy', require('./routes/lemonsqueezy'));
  console.log('✅ LemonSqueezy router mounted');
} catch (err) {
  console.error('❌ LemonSqueezy failed:', err.message);
  console.error('❌ Stack:', err.stack);
}
console.log('✅ All routes mounted successfully');

// =====================
// Health Check
// =====================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// =====================
// Test Endpoint
// =====================
app.get('/api/test', (req, res) => {
  logger.info('📡 Frontend connected!');
  res.status(200).json({
    success: true,
    message: 'Backend connected successfully!',
    timestamp: new Date().toISOString()
  });
});

// =====================
// Error Handler
// =====================
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// ============================================
// ⏰ CRON JOB: Reset Daily Cleanup Quota
// ============================================
cron.schedule('0 0 * * *', async () => {
  console.log('🔄 [CRON] Resetting daily cleanup quota...');
  
  try {
    const User = mongoose.model('User');
    const result = await User.updateMany(
      { subscriptionTier: 'free' },
      { 
        freeCleanupCount: 3,
        lastCleanupReset: new Date()
      }
    );
    
    console.log(`✅ [CRON] Reset ${result.modifiedCount} users' quota to 3`);
  } catch (error) {
    console.error('❌ [CRON] Failed to reset quota:', error);
  }
});

// =====================
// Server Start
// =====================
const PORT = process.env.PORT || 5000;
console.log("🚀 ABOUT TO LISTEN ON PORT:", PORT);

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  
  // ✅ Start email cleanup scheduler (ONLY ONCE)
  try {
    const schedulerService = require('./services/schedulerService');
    schedulerService.start();
    console.log('✅ Email cleanup scheduler initialized successfully');
  } catch (error) {
    console.error('❌ Failed to start scheduler:', error.message);
    console.log('⚠️ Server will continue without auto-cleanup scheduler');
  }
});
