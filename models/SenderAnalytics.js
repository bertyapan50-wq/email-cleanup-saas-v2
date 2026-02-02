const mongoose = require('mongoose');

const senderAnalyticsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  senderDomain: {
    type: String,
    required: true,
    lowercase: true
  },
  // Engagement Metrics
  totalEmails: {
    type: Number,
    default: 0
  },
  emailsOpened: {
    type: Number,
    default: 0
  },
  emailsReplied: {
    type: Number,
    default: 0
  },
  emailsArchived: {
    type: Number,
    default: 0
  },
  emailsDeleted: {
    type: Number,
    default: 0
  },
  emailsMarkedSpam: {
    type: Number,
    default: 0
  },
  // Calculated Scores
  openRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },
  replyRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },
  spamScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },
  importanceScore: {
    type: Number,
    default: 0.5,
    min: 0,
    max: 1
  },
  // Timing Analysis
  averageResponseTime: {
    type: Number, // in hours
    default: null
  },
  lastInteractionDate: {
    type: Date,
    default: null
  },
  firstSeenDate: {
    type: Date,
    default: Date.now
  },
  // Categorization
  category: {
    type: String,
    enum: ['VIP', 'Work', 'Personal', 'Newsletter', 'Promotion', 'Spam', 'Unknown'],
    default: 'Unknown'
  },
  isProtected: {
    type: Boolean,
    default: false
  },
  // AI Learning
  userFeedback: [{
    action: String, // 'kept', 'deleted', 'archived'
    aiSuggestion: String,
    agreedWithAI: Boolean,
    timestamp: Date
  }]
}, {
  timestamps: true
});

// Indexes for performance
senderAnalyticsSchema.index({ userId: 1, senderEmail: 1 }, { unique: true });
senderAnalyticsSchema.index({ userId: 1, importanceScore: -1 });

// Methods
senderAnalyticsSchema.methods.updateMetrics = function() {
  // Calculate rates
  if (this.totalEmails > 0) {
    this.openRate = this.emailsOpened / this.totalEmails;
    this.replyRate = this.emailsReplied / this.totalEmails;
    this.spamScore = this.emailsMarkedSpam / this.totalEmails;
  }
  
  // Calculate importance score based on engagement
  let score = 0.5;
  
  // High engagement = high importance
  if (this.openRate > 0.7) score += 0.2;
  if (this.replyRate > 0.3) score += 0.3;
  
  // Spam = low importance
  if (this.spamScore > 0.5) score -= 0.5;
  
  // Recent interaction = higher importance
  if (this.lastInteractionDate) {
    const daysSinceInteraction = (Date.now() - this.lastInteractionDate) / (1000 * 60 * 60 * 24);
    if (daysSinceInteraction < 7) score += 0.1;
    else if (daysSinceInteraction > 90) score -= 0.1;
  }
  
  // VIP senders get boost
  if (this.category === 'VIP' || this.isProtected) score += 0.2;
  
  this.importanceScore = Math.max(0, Math.min(1, score));
};

// Auto-categorize sender
senderAnalyticsSchema.methods.autoCategorizeSender = function() {
  if (this.isProtected) {
    this.category = 'VIP';
    return;
  }
  
  const domain = this.senderDomain.toLowerCase();
  const email = this.senderEmail.toLowerCase();
  
  // Check for common patterns
  if (email.includes('noreply') || email.includes('no-reply')) {
    this.category = 'Newsletter';
  } else if (domain.includes('marketing') || email.includes('promo')) {
    this.category = 'Promotion';
  } else if (this.spamScore > 0.7) {
    this.category = 'Spam';
  } else if (this.openRate > 0.8 && this.replyRate > 0.3) {
    this.category = 'VIP';
  } else if (domain.includes('company') || domain.includes('corp')) {
    this.category = 'Work';
  } else if (this.replyRate > 0.1) {
    this.category = 'Personal';
  } else {
    this.category = 'Unknown';
  }
};

module.exports = mongoose.model('SenderAnalytics', senderAnalyticsSchema);