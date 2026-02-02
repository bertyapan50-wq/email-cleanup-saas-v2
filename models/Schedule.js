const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Schedule configuration
  scheduleType: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: true
  },
  time: {
    type: String,
    required: true // Format: "09:00"
  },
  dayOfWeek: {
    type: Number,
    min: 0,
    max: 6 // 0=Sunday, 6=Saturday
  },
  dayOfMonth: {
    type: Number,
    min: 1,
    max: 31
  },
  timezone: {
    type: String,
    default: 'Asia/Manila'
  },
  
  // Cleanup configuration
  confidenceLevel: {
    type: String,
    enum: ['high', 'medium', 'all'],
    default: 'high'
  },
  categories: {
    type: [String],
    default: []
  },
  action: {
    type: String,
    enum: ['archive', 'delete'],
    default: 'archive'
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  lastRun: Date,
  nextRun: Date,
  totalRuns: {
    type: Number,
    default: 0
  },
  totalEmailsProcessed: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for faster queries
scheduleSchema.index({ userId: 1, isActive: 1 });
scheduleSchema.index({ nextRun: 1, isActive: 1 });

module.exports = mongoose.model('Schedule', scheduleSchema);