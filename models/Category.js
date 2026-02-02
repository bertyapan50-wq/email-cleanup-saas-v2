const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  name: {
    type: String,
    required: true,
    trim: true
  },
  
  color: {
    type: String,
    default: '#6366f1'
  },
  
  icon: {
    type: String,
    enum: ['folder', 'tag', 'mail', 'inbox', 'sparkles'],
    default: 'folder'
  },
  
  emailCount: {
    type: Number,
    default: 0
  },
  
  description: {
    type: String,
    trim: true
  },
  
  isDefault: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
categorySchema.index({ userId: 1, name: 1 }, { unique: true });

// Methods
categorySchema.methods.incrementEmailCount = async function(count = 1) {
  this.emailCount += count;
  await this.save();
};

categorySchema.methods.decrementEmailCount = async function(count = 1) {
  this.emailCount = Math.max(0, this.emailCount - count);
  await this.save();
};

categorySchema.methods.resetEmailCount = async function() {
  this.emailCount = 0;
  await this.save();
};

// Statics
categorySchema.statics.getUserCategories = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

categorySchema.statics.createDefaultCategories = async function(userId) {
  const defaults = [
    { name: 'Work', color: '#6366f1', icon: 'folder', isDefault: true },
    { name: 'Personal', color: '#ec4899', icon: 'mail', isDefault: true },
    { name: 'Shopping', color: '#eab308', icon: 'tag', isDefault: true },
    { name: 'Newsletter', color: '#8b5cf6', icon: 'sparkles', isDefault: true }
  ];

  const categories = await Promise.all(
    defaults.map(cat => this.create({ userId, ...cat }))
  );

  return categories;
};

module.exports = mongoose.model('Category', categorySchema);