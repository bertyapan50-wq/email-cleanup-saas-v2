const mongoose = require('mongoose');

const scheduleLogSchema = new mongoose.Schema({
  scheduleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Schedule',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  executedAt: {
    type: Date,
    default: Date.now
  },
  emailsProcessed: {
    type: Number,
    default: 0
  },
  actionTaken: {
    type: String,
    enum: ['archive', 'delete']
  },
  status: {
    type: String,
    enum: ['success', 'failed', 'partial'],
    default: 'success'
  },
  errorMessage: String,
  executionTimeMs: Number
}, {
  timestamps: true
});

scheduleLogSchema.index({ scheduleId: 1 });
scheduleLogSchema.index({ userId: 1 });

module.exports = mongoose.model('ScheduleLog', scheduleLogSchema);