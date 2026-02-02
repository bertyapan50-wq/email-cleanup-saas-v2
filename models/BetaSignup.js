const mongoose = require('mongoose');

const betaSignupSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  name: String,
  interestedFeatures: [String],
  source: String,
  status: { type: String, enum: ['pending', 'approved', 'converted'], default: 'pending' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BetaSignup', betaSignupSchema);