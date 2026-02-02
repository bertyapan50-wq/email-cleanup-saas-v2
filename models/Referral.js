const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  // Referrer (person who shared the link)
  referrerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Referred user (person who signed up using the link)
  referredUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Email of referred user (stored before they complete signup)
  referredEmail: {
    type: String,
    lowercase: true
  },
  
  // Status of the referral
  status: {
    type: String,
    enum: ['pending', 'active', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  // Reward amount in cents ($2.00 = 200 cents)
  rewardAmount: {
    type: Number,
    default: 200
  },
  
  // Whether the reward has been claimed
  rewardClaimed: {
    type: Boolean,
    default: false
  },
  
  // OLD FIELDS - kept for backward compatibility
  rewardType: {
    type: String,
    enum: ['month_free', 'year_free', 'lifetime_premium', 'credit']
  },
  
  rewardApplied: {
    type: Boolean,
    default: false
  },
  
  // Timestamps
  signedUpAt: {
    type: Date
  },
  
  subscribedAt: {
    type: Date
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
referralSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Index for faster queries
referralSchema.index({ referrerId: 1, status: 1 });
referralSchema.index({ referredUserId: 1 });

// ✅ PREVENT DUPLICATES: One referral per email
referralSchema.index(
  { referredEmail: 1 }, 
  { 
    unique: true, 
    sparse: true,  // Allow nulls (for incomplete signups)
    partialFilterExpression: { referredEmail: { $type: 'string' } }
  }
);

module.exports = mongoose.model('Referral', referralSchema);