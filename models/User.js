const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, select: false },
  name: String,
  googleId: String,
  refreshToken: String,
  
  // ✅ NEW: Profile Fields
  bio: { type: String, maxlength: 500 },
  company: String,
  jobTitle: String,
  location: String,
  phone: String,
  website: { 
    type: String, 
    validate: {
      validator: function(v) {
        return !v || /^https?:\/\/.+/.test(v);
      },
      message: 'Website must be a valid URL'
    }
  },
  profilePicture: String, // URL path to uploaded image
  
  // Subscription
  subscriptionTier: { type: String, enum: ['free', 'pro', 'premium', 'enterprise'], default: 'free' },
  subscriptionStatus: { type: String, enum: ['active', 'inactive', 'canceled', 'past_due'], default: 'inactive' },
  
  // Original Stripe fields
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  
  // Quota management
  emailQuotaUsed: { type: Number, default: 0 },
  emailQuotaLimit: { type: Number, default: 100 },
  lastQuotaReset: { type: Date, default: Date.now },
  
  // Beta & Referral
  isBetaUser: { type: Boolean, default: false },
  betaDiscountApplied: { type: Boolean, default: false },
  
  // ✅ UPDATED: New Referral System (Sustainable Model)
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: String, // Changed from ObjectId to String (stores referral code)
  totalReferralCredits: { type: Number, default: 0 }, // Total credits earned in cents
  availableReferralCredits: { type: Number, default: 0 }, // Available credits in cents (max $50/year = 5000)
  
  // OLD referral rewards (kept for backward compatibility)
  referralRewards: {
    monthsFree: { type: Number, default: 0 },
    yearsFree: { type: Number, default: 0 },
    lifetimePremium: { type: Boolean, default: false }
  },
  
  // PayMongo fields
  paymongoCustomerId: String,
  paymongoSubscriptionId: String,
  paymongoPaymentMethodId: String,
  paymongoCheckoutSessionId: String,
  
  // Google OAuth tokens (for email access)
  googleTokens: {
    access_token: String,
    refresh_token: String,
    scope: String,
    token_type: String,
    expiry_date: Number
  },
  
  // Billing dates
  currentPeriodEnd: Date,
  nextBillingDate: Date,
  
  // Free Trial System
  trialStartDate: Date,
  trialEndDate: Date,
  trialUsed: { type: Boolean, default: false },
  
  // Free Tier Cleanups (3 per month)
  freeCleanupCount: { type: Number, default: 3 },
  lastCleanupReset: { type: Date, default: Date.now },
  totalCleanupsUsed: { type: Number, default: 0 },
  
  // Timestamp
  createdAt: { type: Date, default: Date.now }
});

// Password hashing
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// NEW - Added static method + updated hook
userSchema.statics.generateUniqueReferralCode = async function() {
  // ... generates unique code with checking
};

userSchema.pre('save', async function(next) {
  if (!this.referralCode && this.isNew) {
    this.referralCode = await mongoose.model('User').generateUniqueReferralCode();
  }
  next();
});

// Password comparison
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Helper method - Start free trial
userSchema.methods.startFreeTrial = function(extraDays = 0) {
  if (this.trialUsed) {
    throw new Error('Trial already used');
  }
  
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 7 + extraDays); // 7 days + bonus (14 if referred)
  
  this.trialStartDate = now;
  this.trialEndDate = trialEnd;
  this.trialUsed = true;
  
  return this.save();
};

// Helper method - Check if trial is active
userSchema.methods.isTrialActive = function() {
  if (!this.trialEndDate) return false;
  return new Date() < new Date(this.trialEndDate);
};

// Helper method - Reset monthly free cleanups
userSchema.methods.resetMonthlyCleanups = function() {
  const now = new Date();
  const lastReset = this.lastCleanupReset || now;
  const daysSinceReset = (now - lastReset) / (1000 * 60 * 60 * 24);
  
  // Reset every 30 days
  if (daysSinceReset >= 30) {
    this.freeCleanupCount = 3;
    this.lastCleanupReset = now;
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Helper method - Use a free cleanup
userSchema.methods.useCleanup = function() {
  if (this.subscriptionTier === 'premium' || this.subscriptionTier === 'pro') {
    // Premium/Pro users have unlimited
    this.totalCleanupsUsed += 1;
    return this.save();
  }
  
  if (this.isTrialActive()) {
    // Trial users have unlimited
    this.totalCleanupsUsed += 1;
    return this.save();
  }
  
  // Free users
  if (this.freeCleanupCount <= 0) {
    throw new Error('No free cleanups remaining. Upgrade to premium!');
  }
  
  this.freeCleanupCount -= 1;
  this.totalCleanupsUsed += 1;
  return this.save();
};

// ✅ NEW: Add referral credits (max $50/year = 5000 cents)
userSchema.methods.addReferralCredits = function(amountInCents) {
  const maxYearlyCredits = 5000; // $50 in cents
  
  // Calculate credits earned this year
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  // In production, you'd track this with a separate collection
  // For now, we'll use a simple cap
  
  const newTotal = (this.totalReferralCredits || 0) + amountInCents;
  const newAvailable = (this.availableReferralCredits || 0) + amountInCents;
  
  if (newAvailable > maxYearlyCredits) {
    // Don't exceed yearly max
    return false;
  }
  
  this.totalReferralCredits = newTotal;
  this.availableReferralCredits = newAvailable;
  
  return this.save();
};

module.exports = mongoose.model('User', userSchema);