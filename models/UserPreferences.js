const mongoose = require('mongoose');

const userPreferencesSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  
  // ==================== APPEARANCE ====================
  theme: {
    type: String,
    enum: ['light', 'dark', 'auto'],
    default: 'light'
  },
  compactMode: {
    type: Boolean,
    default: false
  },
  showEmailPreviews: {
    type: Boolean,
    default: true
  },
  emailsPerPage: {
    type: Number,
    default: 50,
    enum: [25, 50, 100]
  },
  
  // ==================== NOTIFICATIONS ====================
  emailNotifications: {
    type: Boolean,
    default: true
  },
  desktopNotifications: {
    type: Boolean,
    default: false
  },
  priorityEmailsOnly: {
    type: Boolean,
    default: false
  },
  digestFrequency: {
    type: String,
    enum: ['never', 'daily', 'weekly'],
    default: 'daily'
  },
  soundEnabled: {
    type: Boolean,
    default: true
  },
  
  // ==================== EMAIL PROCESSING ====================
  autoArchiveRead: {
    type: Boolean,
    default: false
  },
  autoArchiveDays: {
    type: Number,
    default: 30,
    enum: [7, 30, 90]
  },
  smartCategorization: {
    type: Boolean,
    default: true
  },
  autoLabelImportant: {
    type: Boolean,
    default: true
  },
  spamFilterLevel: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  
  // ==================== AI FEATURES ====================
  aiInsightsEnabled: {
    type: Boolean,
    default: true
  },
  autoSuggestReplies: {
    type: Boolean,
    default: true
  },
  smartFiltersEnabled: {
    type: Boolean,
    default: true
  },
  aiSummaryLength: {
    type: String,
    enum: ['short', 'medium', 'long'],
    default: 'medium'
  },
  
  // ==================== PRIVACY ====================
  shareAnalytics: {
    type: Boolean,
    default: true
  },
  emailTracking: {
    type: Boolean,
    default: false
  },
  readReceipts: {
    type: Boolean,
    default: false
  },
  
  // ==================== LANGUAGE & REGION ====================
  language: {
    type: String,
    default: 'en'
  },
  timezone: {
    type: String,
    default: 'Asia/Manila'
  },
  dateFormat: {
    type: String,
    enum: ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'],
    default: 'MM/DD/YYYY'
  },
  timeFormat: {
    type: String,
    enum: ['12h', '24h'],
    default: '12h'
  },
  
  // ==================== EMAIL RULES ====================
  emailRules: [{
    name: String,
    conditions: [{
      field: String, // 'from', 'subject', 'body'
      operator: String, // 'contains', 'equals', 'startsWith'
      value: String
    }],
    actions: [{
      type: String, // 'label', 'archive', 'delete', 'forward'
      value: String
    }],
    enabled: {
      type: Boolean,
      default: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // ==================== BLOCKED SENDERS ====================
  blockedSenders: [{
    email: String,
    reason: String,
    blockedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // ==================== IMPORTANT KEYWORDS ====================
  importantKeywords: [{
    type: String
  }],
  
  // ==================== NEVER ARCHIVE ====================
  neverArchive: [{
    type: String
  }],
  
  // ==================== METADATA ====================
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Update lastUpdated on save
userPreferencesSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

// Index for faster queries
userPreferencesSchema.index({ userId: 1 });

module.exports = mongoose.model('UserPreferences', userPreferencesSchema);