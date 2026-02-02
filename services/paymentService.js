const axios = require('axios');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');

class PaymentService {
  constructor() {
    this.apiKey = process.env.PAYMONGO_SECRET_KEY;
    this.baseURL = 'https://api.paymongo.com/v1';
    this.auth = Buffer.from(this.apiKey).toString('base64');
  }

  async createPaymentIntent(amount, currency = 'PHP') {
    try {
      const response = await axios.post(
        `${this.baseURL}/payment_intents`,
        { data: { attributes: { amount: amount * 100, currency, payment_method_allowed: ['card', 'gcash', 'grab_pay', 'paymaya'] } } },
        { headers: { 'Authorization': `Basic ${this.auth}`, 'Content-Type': 'application/json' } }
      );
      return response.data.data;
    } catch (error) {
      logger.error('Paymongo payment intent error:', error);
      throw error;
    }
  }

  async createSubscription(userId, plan) {
    try {
      const user = await User.findById(userId);
      const pricing = { pro: 499, enterprise: 1499 };
      const amount = pricing[plan];
      const finalAmount = user.isBetaUser && !user.betaDiscountApplied ? amount * 0.5 : amount;

      const paymentIntent = await this.createPaymentIntent(finalAmount, 'PHP');

      // Update user
      user.subscriptionTier = plan;
      user.subscriptionStatus = 'pending';
      if (user.isBetaUser) user.betaDiscountApplied = true;
      user.emailQuotaLimit = 999999;
      await user.save();

      // Create subscription record
      await Subscription.create({
        userId,
        plan,
        provider: 'paymongo',
        subscriptionId: paymentIntent.id,
        status: 'pending',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      return { clientKey: paymentIntent.attributes.client_key, amount: finalAmount, currency: 'PHP' };
    } catch (error) {
      logger.error('Subscription creation error:', error);
      throw error;
    }
  }

  async verifyPayment(paymentIntentId) {
    try {
      const response = await axios.get(`${this.baseURL}/payment_intents/${paymentIntentId}`, { headers: { 'Authorization': `Basic ${this.auth}` } });
      return response.data.data;
    } catch (error) {
      logger.error('Payment verification error:', error);
      throw error;
    }
  }

  async cancelSubscription(userId) {
    try {
      const user = await User.findById(userId);
      const subscription = await Subscription.findOne({ userId, status: 'active' });
      if (!subscription) throw new Error('No active subscription found');

      subscription.status = 'canceled';
      subscription.cancelAtPeriodEnd = true;
      subscription.updatedAt = new Date();
      await subscription.save();

      user.subscriptionStatus = 'canceled';
      await user.save();

      return { success: true, message: 'Subscription will be canceled at period end' };
    } catch (error) {
      logger.error('Subscription cancellation error:', error);
      throw error;
    }
  }

  async handleWebhook(event) {
    try {
      const eventType = event.data.attributes.type;
      switch (eventType) {
        case 'payment.paid': await this.handlePaymentSuccess(event.data.attributes.data); break;
        case 'payment.failed': await this.handlePaymentFailure(event.data.attributes.data); break;
        default: logger.info(`Unhandled webhook event: ${eventType}`);
      }
    } catch (error) {
      logger.error('Webhook handling error:', error);
      throw error;
    }
  }

  async handlePaymentSuccess(paymentData) {
    try {
      const subscription = await Subscription.findOne({ subscriptionId: paymentData.attributes.payment_intent_id });
      if (subscription) {
        subscription.status = 'active';
        subscription.updatedAt = new Date();
        await subscription.save();

        const user = await User.findById(subscription.userId);
        user.subscriptionStatus = 'active';
        await user.save();

        logger.info(`Payment successful for user ${user._id}`);
      }
    } catch (error) {
      logger.error('Payment success handler error:', error);
    }
  }

  async handlePaymentFailure(paymentData) {
    try {
      const subscription = await Subscription.findOne({ subscriptionId: paymentData.attributes.payment_intent_id });
      if (subscription) {
        const user = await User.findById(subscription.userId);
        user.subscriptionStatus = 'past_due';
        await user.save();

        logger.info(`Payment failed for user ${user._id}`);
      }
    } catch (error) {
      logger.error('Payment failure handler error:', error);
    }
  }
}

module.exports = new PaymentService();
