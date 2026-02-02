const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const paymentService = require('../services/paymentService');
const logger = require('../utils/logger');

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    await paymentService.handleWebhook(event);
    res.json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook error:', error);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

router.post('/paypal', async (req, res) => {
  try {
    logger.info('PayPal webhook received:', req.body);
    res.json({ received: true });
  } catch (error) {
    logger.error('PayPal webhook error:', error);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

module.exports = router;