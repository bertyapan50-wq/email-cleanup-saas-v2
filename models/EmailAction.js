const mongoose = require('mongoose');

const emailActionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  emailId: {
    type: String,
    required: true
  },
  action: {
    type: String,
    enum: ['delete', 'archive', 'mark_spam', 'keep', 'unsubscribe'],
    required: true
  },
  metadata: {
    sender: String,
    senderDomain: String,
    subject: String,
    date: String,
    labels: [String],
    snippet: String,
    category: String,
    ageInDays: Number
  },
  // Enhanced AI Analysis
  aiSuggestion: {
    action: String,
    confidence: {
      type: Number,
      min: 0,
      max: 1
    },
    reasoning: String,
    factors: [{
      factor: String,
      score: Number,
      weight: Number
    }],
    // Multi-factor scores
    scores: {
      ageScore: Number,
      engagementScore: Number,
      senderReputationScore: Number,
      contentScore: Number,
      categoryScore: Number,
      finalScore: Number
    }
  },
  // User feedback for learning
  executed: {
    type: Boolean,
    default: false
  },
  executedAt: Date,
  userApproved: {
    type: Boolean,
    default: null
  },
  userRejected: {
    type: Boolean,
    default: false
  },
  userFeedback: {
    agreedWithAI: Boolean,
    reason: String
  }
}, {
  timestamps: true
});

// Indexes
emailActionSchema.index({ userId: 1, executed: 1 });
emailActionSchema.index({ userId: 1, createdAt: -1 });
emailActionSchema.index({ userId: 1, 'metadata.sender': 1 });

// Method to record user feedback for AI learning
emailActionSchema.methods.recordFeedback = function(agreed, reason = null) {
  this.userFeedback = {
    agreedWithAI: agreed,
    reason: reason
  };
  
  if (!agreed) {
    this.userRejected = true;
  }
};

module.exports = mongoose.model('EmailAction', emailActionSchema);