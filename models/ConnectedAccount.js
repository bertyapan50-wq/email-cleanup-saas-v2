const mongoose = require('mongoose');

const connectedAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // ==================== ACCOUNT INFO ====================
  email: {
    type: String,
    required: true
  },
  provider: {
    type: String,
    enum: ['gmail', 'outlook', 'yahoo'],
    required: true,
    default: 'gmail'
  },
  
  // ==================== STATUS ====================
  status: {
    type: String,
    enum: ['connected', 'error', 'disconnected', 'syncing'],
    default: 'connected'
  },
  isPrimary: {
    type: Boolean,
    default: false
  },
  
  // ==================== OAUTH TOKENS ====================
  accessToken: {
    type: String,
    required: true
  },
  refreshToken: {
    type: String
  },
  tokenExpiry: {
    type: Date
  },
  
  // ==================== PERMISSIONS ====================
  permissions: [{
    type: String,
    enum: ['read', 'send', 'modify', 'delete']
  }],
  
  // ==================== SYNC INFO ====================
  lastSync: {
    type: Date,
    default: Date.now
  },
  lastSuccessfulSync: {
    type: Date
  },
  syncStatus: {
    type: String,
    enum: ['idle', 'syncing', 'error'],
    default: 'idle'
  },
  syncError: {
    message: String,
    timestamp: Date
  },
  
  // ==================== STATS ====================
  emailsProcessed: {
    type: Number,
    default: 0
  },
  emailsSynced: {
    type: Number,
    default: 0
  },
  lastEmailDate: {
    type: Date
  },
  
  // ==================== SETTINGS ====================
  settings: {
    autoSync: {
      type: Boolean,
      default: true
    },
    syncInterval: {
      type: Number,
      default: 300000 // 5 minutes in ms
    },
    syncLabels: {
      type: Boolean,
      default: true
    },
    syncAttachments: {
      type: Boolean,
      default: false
    }
  },
  
  // ==================== METADATA ====================
  connectedAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
connectedAccountSchema.index({ userId: 1 });
connectedAccountSchema.index({ email: 1 });
connectedAccountSchema.index({ userId: 1, isPrimary: 1 });

// Methods
connectedAccountSchema.methods.updateLastSync = function() {
  this.lastSync = new Date();
  this.lastSuccessfulSync = new Date();
  this.syncStatus = 'idle';
  return this.save();
};

connectedAccountSchema.methods.setSyncError = function(errorMessage) {
  this.syncStatus = 'error';
  this.status = 'error';
  this.syncError = {
    message: errorMessage,
    timestamp: new Date()
  };
  return this.save();
};

connectedAccountSchema.methods.incrementEmailsProcessed = function(count = 1) {
  this.emailsProcessed += count;
  this.lastUsed = new Date();
  return this.save();
};

// Static methods
connectedAccountSchema.statics.getPrimaryAccount = function(userId) {
  return this.findOne({ userId, isPrimary: true });
};

connectedAccountSchema.statics.getUserAccounts = function(userId) {
  return this.find({ userId }).sort({ isPrimary: -1, connectedAt: 1 });
};

module.exports = mongoose.model('ConnectedAccount', connectedAccountSchema);