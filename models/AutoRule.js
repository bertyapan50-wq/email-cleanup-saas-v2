const mongoose = require('mongoose');

const AutoRuleSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  name: { type: String, required: true },
  prompt: { type: String, required: true },
  action: { 
    type: String, 
    enum: ['archive', 'delete', 'label', 'star', 'notify'],
    required: true 
  },
  label: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('AutoRule', AutoRuleSchema);