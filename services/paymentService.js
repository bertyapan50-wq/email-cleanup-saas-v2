const axios = require('axios');
const crypto = require('crypto');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');

class PaymentService {
  constructor() {
    this.apiKey = process.env.LEMONSQUEEZY_API_KEY;
    this.storeId = process.env.LEMONSQUEEZY_STORE_ID;
    this.webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    this.baseURL = 'https://api.lemonsqueezy.com/v1';
    this.headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json'
    };
  }

  // Get variant ID based on plan and billing cycle
  getVariantId(plan, billingCycle = 'monthly') {
    const variants = {
      pro: {
        monthly: process.env.LEMONSQUEEZY_MONTHLY_VARIANT_ID,
        annual: process.env.LEMONSQUEEZY_ANNUAL_VARIANT_ID
      }
    };
    return variants[plan]?.[billingCycle] || variants.pro.monthly;
  }

  // Create a Lemon Squeezy checkout URL
  async createCheckout(userId, plan, billingCycle = 'monthly') {
    try {
      const user = await User.findById(userId);
      const variantId = this.getVariantId(plan, billingCycle);

      // Apply beta discount if applicable
      const discountPercent = (user.isBetaUser && !user.betaDiscountApplied) ? 50 : 0;

      const payload = {
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: user.email,
              name: user.name || '',
              custom: {
                userId: userId.toString(),
                plan,
                billingCycle
              }
            },
            checkout_options: {
              embed: false,
              media: true,
              logo: true
            },
            ...(discountPercent && {
              preview: {
                discount_percent: discountPercent
              }
            })
          },
          relationships: {
            store: {
              data: { type: 'stores', id: this.storeId }
            },
            variant: {
              data: { type: 'variants', id: variantId }
            }
          }
        }
      };

      const response = await axios.post(`${this.baseURL}/checkouts`, payload, { headers: this.headers });
      const checkoutUrl = response.data.data.attributes.url;

      // Update user status to pending
      user.subscriptionTier = plan;
      user.subscriptionStatus = 'pending';
      await user.save();

      logger.info(`Checkout created for user ${userId}: ${checkoutUrl}`);
      return { checkoutUrl, plan, billingCycle };
    } catch (error) {
      logger.error('Lemon Squeezy checkout error:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get subscription details from Lemon Squeezy
  async getSubscription(subscriptionId) {
    try {
      const response = await axios.get(`${this.baseURL}/subscriptions/${subscriptionId}`, { headers: this.headers });
      return response.data.data;
    } catch (error) {
      logger.error('Get subscription error:', error.response?.data || error.message);
      throw error;
    }
  }

  // Cancel subscription
  async cancelSubscription(userId) {
    try {
      const user = await User.findById(userId);
      const subscription = await Subscription.findOne({ userId, status: 'active' });
      if (!subscription) throw new Error('No active subscription found');

      // Cancel on Lemon Squeezy (cancel at period end)
      await axios.delete(`${this.baseURL}/subscriptions/${subscription.subscriptionId}`, { headers: this.headers });

      subscription.status = 'canceled';
      subscription.cancelAtPeriodEnd = true;
      subscription.updatedAt = new Date();
      await subscription.save();

      user.subscriptionStatus = 'canceled';
      await user.save();

      logger.info(`Subscription canceled for user ${userId}`);
      return { success: true, message: 'Subscription will be canceled at period end' };
    } catch (error) {
      logger.error('Subscription cancellation error:', error.response?.data || error.message);
      throw error;
    }
  }

  // Verify webhook signature from Lemon Squeezy
  verifyWebhookSignature(rawBody, signature) {
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    const digest = hmac.update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  }

  // Handle incoming webhooks from Lemon Squeezy
  async handleWebhook(event) {
    try {
      const eventType = event.meta.event_name;
      logger.info(`Lemon Squeezy webhook received: ${eventType}`);

      switch (eventType) {
        case 'subscription_created':
          await this.handleSubscriptionCreated(event.data);
          break;
        case 'subscription_updated':
          await this.handleSubscriptionUpdated(event.data);
          break;
        case 'subscription_cancelled':
          await this.handleSubscriptionCancelled(event.data);
          break;
        case 'subscription_expired':
          await this.handleSubscriptionExpired(event.data);
          break;
        case 'subscription_payment_success':
          await this.handlePaymentSuccess(event.data);
          break;
        case 'subscription_payment_failed':
          await this.handlePaymentFailed(event.data);
          break;
        default:
          logger.info(`Unhandled webhook event: ${eventType}`);
      }
    } catch (error) {
      logger.error('Webhook handling error:', error);
      throw error;
    }
  }

  async handleSubscriptionCreated(data) {
    try {
      const userId = data.attributes.custom_data?.userId;
      const plan = data.attributes.custom_data?.plan || 'pro';
      if (!userId) return logger.warn('No userId in webhook custom_data');

      const user = await User.findById(userId);
      if (!user) return logger.warn(`User not found: ${userId}`);

      // Apply beta discount flag
      if (user.isBetaUser && !user.betaDiscountApplied) {
        user.betaDiscountApplied = true;
      }

      user.subscriptionStatus = 'active';
      user.subscriptionTier = plan;
      user.emailQuotaLimit = 999999;
      await user.save();

      await Subscription.findOneAndUpdate(
        { userId },
        {
          userId,
          plan,
          provider: 'lemonsqueezy',
          subscriptionId: data.id,
          status: 'active',
          currentPeriodStart: new Date(data.attributes.renews_at),
          currentPeriodEnd: new Date(data.attributes.ends_at || Date.now() + 30 * 24 * 60 * 60 * 1000),
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );

      logger.info(`Subscription created for user ${userId}`);
    } catch (error) {
      logger.error('Subscription created handler error:', error);
    }
  }

  async handleSubscriptionUpdated(data) {
    try {
      const subscription = await Subscription.findOne({ subscriptionId: data.id });
      if (!subscription) return;

      const lsStatus = data.attributes.status;
      const statusMap = { active: 'active', past_due: 'past_due', cancelled: 'canceled', expired: 'expired' };
      const newStatus = statusMap[lsStatus] || lsStatus;

      subscription.status = newStatus;
      subscription.currentPeriodEnd = new Date(data.attributes.renews_at);
      subscription.updatedAt = new Date();
      await subscription.save();

      const user = await User.findById(subscription.userId);
      if (user) {
        user.subscriptionStatus = newStatus;
        await user.save();
      }

      logger.info(`Subscription updated for user ${subscription.userId}: ${newStatus}`);
    } catch (error) {
      logger.error('Subscription updated handler error:', error);
    }
  }

  async handleSubscriptionCancelled(data) {
    try {
      const subscription = await Subscription.findOne({ subscriptionId: data.id });
      if (!subscription) return;

      subscription.status = 'canceled';
      subscription.cancelAtPeriodEnd = true;
      subscription.updatedAt = new Date();
      await subscription.save();

      const user = await User.findById(subscription.userId);
      if (user) {
        user.subscriptionStatus = 'canceled';
        await user.save();
      }

      logger.info(`Subscription cancelled for user ${subscription.userId}`);
    } catch (error) {
      logger.error('Subscription cancelled handler error:', error);
    }
  }

  async handleSubscriptionExpired(data) {
    try {
      const subscription = await Subscription.findOne({ subscriptionId: data.id });
      if (!subscription) return;

      subscription.status = 'expired';
      subscription.updatedAt = new Date();
      await subscription.save();

      const user = await User.findById(subscription.userId);
      if (user) {
        user.subscriptionStatus = 'expired';
        user.subscriptionTier = 'free';
        user.emailQuotaLimit = 100; // Reset to free tier
        await user.save();
      }

      logger.info(`Subscription expired for user ${subscription.userId}`);
    } catch (error) {
      logger.error('Subscription expired handler error:', error);
    }
  }

  async handlePaymentSuccess(data) {
    try {
      const subscription = await Subscription.findOne({ subscriptionId: data.attributes.subscription_id });
      if (!subscription) return;

      subscription.status = 'active';
      subscription.updatedAt = new Date();
      await subscription.save();

      const user = await User.findById(subscription.userId);
      if (user) {
        user.subscriptionStatus = 'active';
        await user.save();
      }

      logger.info(`Payment successful for user ${subscription.userId}`);
    } catch (error) {
      logger.error('Payment success handler error:', error);
    }
  }

  async handlePaymentFailed(data) {
    try {
      const subscription = await Subscription.findOne({ subscriptionId: data.attributes.subscription_id });
      if (!subscription) return;

      const user = await User.findById(subscription.userId);
      if (user) {
        user.subscriptionStatus = 'past_due';
        await user.save();
      }

      logger.info(`Payment failed for user ${subscription.userId}`);
    } catch (error) {
      logger.error('Payment failure handler error:', error);
    }
  }
}

module.exports = new PaymentService();