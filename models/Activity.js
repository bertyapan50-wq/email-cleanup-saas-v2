const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  action: {
    type: String,
    required: true,
    enum: [
      // Auth
      'login',
      'logout',
      'signup',
      
      // Profile
      'profile_update',
      'profile_picture_upload',
      'profile_picture_delete',
      
      // Settings
      'settings_update',
      'password_change',
      
      // Email Actions
      'email_processed',
      'email_archived',
      'email_deleted',
      
      // Cleanup
      'cleanup_performed',
      'bulk_action',
      
      // Subscription
      'subscription_change',
      'payment_success',
      'payment_failed',
      
      // Referrals
      'referral_shared',
      'referral_signup',
      
      // OAuth
      'oauth_connected',
      'oauth_disconnected',
      
      // ✅ NEW: Labels & Follow-ups
      'label_created',
      'label_updated',
      'label_deleted',
      'followup_created',
      'followup_completed',
      'followup_deleted',
      
      // ✅ NEW: Filters & AI
      'filter_created',
      'filter_updated',
      'ai_suggestion_accepted',
      'ai_suggestion_rejected',
      
      // ✅ NEW: Activity Management
      'activity_logs_cleared',
      
      // ✅ NEW: Catch-all
      'general_action'
    ]
  },
  
  description: {
    type: String,
    required: true
  },
  
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  ipAddress: {
    type: String
  },
  
  userAgent: {
    type: String
  },
  
  status: {
    type: String,
    enum: ['success', 'failed', 'pending'],
    default: 'success'
  },
  
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Index for faster queries
activitySchema.index({ userId: 1, timestamp: -1 });
activitySchema.index({ action: 1, timestamp: -1 });

// Auto-delete old activities after 90 days (optional)
activitySchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

module.exports = mongoose.model('Activity', activitySchema);