const mongoose = require('mongoose');

const paymentHistorySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'PHP' },
  status: { type: String, enum: ['paid', 'pending', 'failed', 'refunded'], default: 'pending' },
  paymentIntentId: String,
  checkoutSessionId: String,
  invoiceNumber: String,
  description: String,
  method: { type: String, default: 'paymongo' },
  billingCycle: { type: String, enum: ['monthly', 'annual'] },
  metadata: Object
});

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: String, enum: ['free', 'pro', 'premium', 'enterprise'], required: true },
  provider: { type: String, enum: ['stripe', 'paymongo', 'paypal', 'free'], default: 'free' },
  
  // Payment provider IDs
  subscriptionId: String,
  checkoutSessionId: String,
  
  // Status
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'canceled', 'past_due', 'trialing'], 
    default: 'active' 
  },
  
  // Billing cycle
  billingCycle: { type: String, enum: ['monthly', 'annual'], default: 'monthly' },
  
  // Period dates
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  
  // Cancellation
  cancelAtPeriodEnd: { type: Boolean, default: false },
  canceledAt: Date,
  cancellationReason: String,
  
  // Trial
  trialEnd: Date,
  
  // Payment method
  paymentMethod: { type: String, default: 'card' },
  
  // Payment history - BAGONG FIELD ITO!
  paymentHistory: [paymentHistorySchema],
  
  // Metadata
  metadata: {
    type: Map,
    of: String
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
subscriptionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Helper method: Add payment to history
subscriptionSchema.methods.addPayment = function(paymentData) {
  this.paymentHistory.push({
    date: paymentData.date || new Date(),
    amount: paymentData.amount,
    currency: paymentData.currency || 'PHP',
    status: paymentData.status || 'paid',
    paymentIntentId: paymentData.paymentIntentId,
    checkoutSessionId: paymentData.checkoutSessionId,
    invoiceNumber: paymentData.invoiceNumber || `INV-${Date.now()}`,
    description: paymentData.description,
    method: paymentData.method || 'paymongo',
    billingCycle: paymentData.billingCycle || this.billingCycle,
    metadata: paymentData.metadata
  });
  return this.save();
};

// Helper method: Check if subscription is active
subscriptionSchema.methods.isActive = function() {
  return this.status === 'active' && new Date() < new Date(this.currentPeriodEnd);
};

module.exports = mongoose.model('Subscription', subscriptionSchema);