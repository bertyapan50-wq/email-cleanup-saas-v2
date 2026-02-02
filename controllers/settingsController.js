const User = require('../models/User');
const UserPreferences = require('../models/UserPreferences');
const ConnectedAccount = require('../models/ConnectedAccount');
const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');
const gmailService = require('../services/gmailService'); // ✅ ADD THIS!
const emailNotificationService = require('../services/emailNotificationService');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// ==================== PREFERENCES ====================
exports.getPreferences = async (req, res) => {
  try {
    let preferences = await UserPreferences.findOne({ userId: req.user._id });
    
    // Create default preferences if none exist
    if (!preferences) {
      preferences = await UserPreferences.create({
        userId: req.user._id,
        ...getDefaultPreferences()
      });
    }

    res.json({
      success: true,
      preferences: preferences.toObject()
    });
  } catch (error) {
    logger.error('Error fetching preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch preferences'
    });
  }
};

exports.updatePreferences = async (req, res) => {
  try {
    const { preferences } = req.body;

    let userPrefs = await UserPreferences.findOne({ userId: req.user._id });

    if (!userPrefs) {
      userPrefs = new UserPreferences({
        userId: req.user._id,
        ...preferences
      });
    } else {
      Object.assign(userPrefs, preferences);
    }

    await userPrefs.save();

    logger.info(`User ${req.user.email} updated preferences`);

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      preferences: userPrefs.toObject()
    });
  } catch (error) {
    logger.error('Error updating preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update preferences'
    });
  }
};

exports.resetPreferences = async (req, res) => {
  try {
    const defaults = getDefaultPreferences();
    
    let userPrefs = await UserPreferences.findOne({ userId: req.user._id });
    
    if (userPrefs) {
      Object.assign(userPrefs, defaults);
      await userPrefs.save();
    } else {
      userPrefs = await UserPreferences.create({
        userId: req.user._id,
        ...defaults
      });
    }

    res.json({
      success: true,
      message: 'Preferences reset to defaults',
      preferences: userPrefs.toObject()
    });
  } catch (error) {
    logger.error('Error resetting preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset preferences'
    });
  }
};

// ==================== CONNECTED ACCOUNTS ====================
exports.getConnectedAccounts = async (req, res) => {
  try {
    const accounts = await ConnectedAccount.find({ userId: req.user._id });

    // Transform accounts data
    const accountsData = accounts.map(acc => ({
      id: acc._id,
      email: acc.email,
      provider: acc.provider,
      isPrimary: acc.isPrimary,
      status: acc.status,
      lastSync: acc.lastSync,
      emailsProcessed: acc.emailsProcessed || 0,
      permissions: acc.permissions || ['read', 'send', 'modify']
    }));

    res.json({
      success: true,
      accounts: accountsData
    });
  } catch (error) {
    logger.error('Error fetching connected accounts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch connected accounts'
    });
  }
};

exports.disconnectAccount = async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const account = await ConnectedAccount.findOne({
      _id: accountId,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    // Don't allow disconnecting primary account
    if (account.isPrimary) {
      return res.status(400).json({
        success: false,
        message: 'Cannot disconnect primary account'
      });
    }

    await account.remove();

    logger.info(`User ${req.user.email} disconnected account ${account.email}`);

    res.json({
      success: true,
      message: 'Account disconnected successfully'
    });
  } catch (error) {
    logger.error('Error disconnecting account:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect account'
    });
  }
};

exports.updateAccountSettings = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { settings } = req.body;

    const account = await ConnectedAccount.findOneAndUpdate(
      { _id: accountId, userId: req.user._id },
      { $set: settings },
      { new: true }
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    res.json({
      success: true,
      message: 'Account settings updated',
      account
    });
  } catch (error) {
    logger.error('Error updating account settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update account settings'
    });
  }
};

// Add this to controllers/settingsController.js
// Replace the syncAccount function



exports.syncAccount = async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const account = await ConnectedAccount.findOne({
      _id: accountId,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    // Check if account has valid tokens
    if (!account.accessToken || !account.refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Account not properly connected. Please reconnect.'
      });
    }

    // Update sync status
    account.syncStatus = 'syncing';
    account.lastSyncAttempt = new Date();
    await account.save();

    // Trigger email sync in background
    syncEmailsInBackground(account, req.user._id);

    res.json({
      success: true,
      message: 'Account sync initiated',
      status: 'syncing',
      lastSync: account.lastSync
    });
  } catch (error) {
    logger.error('Error syncing account:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync account'
    });
  }
};

// Background sync function
async function syncEmailsInBackground(account, userId) {
  try {
    logger.info(`Starting sync for account ${account.email}`);
    
    // Use Gmail API to fetch emails
    const emails = await gmailService.fetchEmails(account.accessToken, {
      maxResults: 100,
      q: `after:${Math.floor(account.lastSync?.getTime() / 1000) || 0}`
    });

    logger.info(`Fetched ${emails.length} new emails for ${account.email}`);

    // Process each email - TEMPORARILY DISABLED (no Email model)
// for (const email of emails) {
//   await processEmail(email, userId, account._id);
// }
logger.info(`Fetched ${emails.length} emails (saving disabled - no Email model)`);
    // Update account sync status
    account.syncStatus = 'idle';  // ✅ TAMA
    account.lastSync = new Date();
    account.emailsProcessed = (account.emailsProcessed || 0) + emails.length;
    await account.save();

    logger.info(`Sync completed for account ${account.email}`);

    // Notification service - TEMPORARILY DISABLED
// await emailNotificationService.sendSyncCompleteNotification(userId, {
//   accountEmail: account.email,
//   emailsProcessed: emails.length
// });
  } catch (error) {
    logger.error(`Sync failed for account ${account.email}:`, error);
    
    // Update account with error status
    account.syncStatus = 'error';  // ✅ TAMA - 'error' is allowed
    account.lastSyncError = error.message;
    await account.save();
  }
}

// Helper function to process individual emails
async function processEmail(emailData, userId, accountId) {
  const Email = require('../models/Email'); // Assuming you have this model
  
  try {
    // Check if email already exists
    const existingEmail = await Email.findOne({
      messageId: emailData.id,
      userId: userId
    });

    if (existingEmail) {
      return; // Skip duplicates
    }

    // Create new email record
    const newEmail = new Email({
      userId: userId,
      accountId: accountId,
      messageId: emailData.id,
      threadId: emailData.threadId,
      subject: emailData.subject,
      from: emailData.from,
      to: emailData.to,
      body: emailData.snippet,
      fullBody: emailData.body,
      date: new Date(emailData.internalDate),
      labels: emailData.labelIds,
      isRead: !emailData.labelIds.includes('UNREAD'),
      isStarred: emailData.labelIds.includes('STARRED'),
      isImportant: emailData.labelIds.includes('IMPORTANT')
    });

    await newEmail.save();
  } catch (error) {
    logger.error('Error processing email:', error);
  }
}

// ==================== SUBSCRIPTION (UPDATED) ====================
exports.getCurrentSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    let subscription = await Subscription.findOne({ userId: req.user._id });

    // If no subscription record exists but user has premium tier, create one
    if (!subscription && user.subscriptionTier !== 'free') {
      subscription = await Subscription.create({
        userId: user._id,
        plan: user.subscriptionTier,
        status: user.subscriptionStatus || 'active',
        provider: 'paymongo',
        billingCycle: 'monthly',
        currentPeriodStart: new Date(),
        currentPeriodEnd: user.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
    }

    // Return free tier info if no subscription
    if (!subscription) {
      return res.json({
        success: true,
        subscription: {
          tier: 'free',
          status: 'active',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          paymentMethod: null,
          quotaUsed: user.emailQuotaUsed || 0,
          quotaLimit: user.emailQuotaLimit || 100
        }
      });
    }

    res.json({
      success: true,
      subscription: {
        tier: subscription.plan,
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        canceledAt: subscription.canceledAt,
        paymentMethod: subscription.paymentMethod,
        quotaUsed: user.emailQuotaUsed || 0,
        quotaLimit: user.emailQuotaLimit || 999999
      }
    });
  } catch (error) {
    logger.error('Error fetching subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription'
    });
  }
};

exports.getPaymentHistory = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ userId: req.user._id });

    if (!subscription || !subscription.paymentHistory || subscription.paymentHistory.length === 0) {
      return res.json({
        success: true,
        payments: []
      });
    }

    // Sort by date, newest first
    const payments = subscription.paymentHistory
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(payment => ({
        _id: payment._id,
        date: payment.date,
        amount: payment.amount / 100, // Convert from centavos to pesos
        currency: payment.currency,
        status: payment.status,
        description: payment.description || `${subscription.plan} Subscription`,
        invoiceNumber: payment.invoiceNumber,
        method: payment.method,
        billingCycle: payment.billingCycle
      }));

    res.json({
      success: true,
      payments
    });
  } catch (error) {
    logger.error('Error fetching payment history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history'
    });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const subscription = await Subscription.findOne({ 
      userId: req.user._id,
      status: 'active'
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    // Mark for cancellation at period end
    subscription.cancelAtPeriodEnd = true;
    subscription.canceledAt = new Date();
    subscription.cancellationReason = req.body.reason || 'User requested cancellation';
    await subscription.save();

    // Update user status
    user.subscriptionStatus = 'canceled';
    await user.save();

    logger.info(`Subscription cancelled for user ${user.email}. Will end on ${subscription.currentPeriodEnd}`);

    // Send cancellation email
    const emailNotificationService = require('../services/emailNotificationService');
    try {
      await emailNotificationService.sendEmail({
        to: user.email,
        subject: 'Subscription Cancellation Confirmed',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Subscription Cancelled</h2>
            <p>Hi ${user.name},</p>
            <p>Your subscription has been cancelled as requested.</p>
            <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 15px; margin: 20px 0;">
              <p><strong>Important:</strong> You will continue to have access to premium features until ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}.</p>
            </div>
            <p>After this date, your account will revert to the free plan.</p>
            <p>If you change your mind, you can reactivate your subscription anytime before it expires.</p>
          </div>
        `
      });
    } catch (emailError) {
      logger.error('Failed to send cancellation email:', emailError);
    }

    res.json({
      success: true,
      message: 'Subscription cancelled. You will have access until the end of your billing period.',
      endsOn: subscription.currentPeriodEnd
    });
  } catch (error) {
    logger.error('Error cancelling subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel subscription'
    });
  }
};

exports.reactivateSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const subscription = await Subscription.findOne({ userId: req.user._id });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No subscription found. Please create a new subscription.'
      });
    }

    // Check if subscription is still within current period
    if (new Date() > new Date(subscription.currentPeriodEnd)) {
      return res.status(400).json({
        success: false,
        message: 'Subscription has already expired. Please create a new subscription.'
      });
    }

    // Reactivate
    subscription.cancelAtPeriodEnd = false;
    subscription.status = 'active';
    subscription.canceledAt = null;
    subscription.cancellationReason = null;
    await subscription.save();

    // Update user
    user.subscriptionStatus = 'active';
    await user.save();

    logger.info(`Subscription reactivated for user ${user.email}`);

    // Send reactivation email
    const emailNotificationService = require('../services/emailNotificationService');
    try {
      await emailNotificationService.sendEmail({
        to: user.email,
        subject: 'Subscription Reactivated! 🎉',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Welcome Back!</h2>
            <p>Hi ${user.name},</p>
            <p>Great news! Your subscription has been reactivated.</p>
            <div style="background: #ECFDF5; border-left: 4px solid #10B981; padding: 15px; margin: 20px 0;">
              <p><strong>Your subscription details:</strong></p>
              <ul>
                <li>Plan: ${subscription.plan.toUpperCase()}</li>
                <li>Status: Active</li>
                <li>Next billing date: ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}</li>
              </ul>
            </div>
            <p>You now have full access to all premium features again!</p>
          </div>
        `
      });
    } catch (emailError) {
      logger.error('Failed to send reactivation email:', emailError);
    }

    res.json({
      success: true,
      message: 'Subscription reactivated successfully!',
      subscription: {
        tier: subscription.plan,
        status: subscription.status,
        nextBillingDate: subscription.currentPeriodEnd
      }
    });
  } catch (error) {
    logger.error('Error reactivating subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate subscription'
    });
  }
};

exports.updatePaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId } = req.body;
    
    if (!paymentMethodId) {
      return res.status(400).json({
        success: false,
        message: 'Payment method ID is required'
      });
    }

    const subscription = await Subscription.findOne({ userId: req.user._id });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No subscription found'
      });
    }

    subscription.paymentMethod = paymentMethodId;
    await subscription.save();

    logger.info(`Payment method updated for user ${req.user.email}`);

    res.json({
      success: true,
      message: 'Payment method updated successfully'
    });
  } catch (error) {
    logger.error('Error updating payment method:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment method'
    });
  }
};
// ==================== DOWNLOAD INVOICE ====================
exports.downloadInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    // Find the subscription and payment
    const subscription = await Subscription.findOne({ userId: req.user._id });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No subscription found'
      });
    }

    // Find the specific payment in history
    const payment = subscription.paymentHistory?.find(
      p => p._id.toString() === invoiceId
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Get user info
    const user = await User.findById(req.user._id).select('name email');

    // Generate PDF
    const doc = new PDFDocument({ margin: 50 });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=invoice-${invoiceId}.pdf`
    );

    // Pipe PDF to response
    doc.pipe(res);

    // Add company logo/header
    doc
      .fontSize(20)
      .text('INVOICE', 50, 50, { align: 'center' })
      .moveDown();

    // Invoice details
    doc
      .fontSize(10)
      .text(`Invoice #: ${payment.invoiceNumber || invoiceId}`, 50, 120)
      .text(`Date: ${new Date(payment.date).toLocaleDateString()}`, 50, 135)
      .text(`Status: ${payment.status.toUpperCase()}`, 50, 150)
      .moveDown();

    // Bill to section
    doc
      .fontSize(12)
      .text('Bill To:', 50, 180)
      .fontSize(10)
      .text(user.name, 50, 200)
      .text(user.email, 50, 215)
      .moveDown();

    // Items table header
    const tableTop = 270;
    doc
      .fontSize(10)
      .text('Description', 50, tableTop)
      .text('Amount', 400, tableTop, { width: 90, align: 'right' });

    // Draw line
    doc
      .moveTo(50, tableTop + 15)
      .lineTo(550, tableTop + 15)
      .stroke();

    // Items
    const itemY = tableTop + 30;
    doc
      .fontSize(10)
      .text(
        payment.description || `${subscription.plan.toUpperCase()} Plan`,
        50,
        itemY
      )
      .text(`₱${(payment.amount / 100).toFixed(2)}`, 400, itemY, { width: 90, align: 'right' });

    // Total
    const totalY = itemY + 50;
    doc
      .moveTo(50, totalY - 10)
      .lineTo(550, totalY - 10)
      .stroke();

    doc
      .fontSize(12)
      .text('Total:', 50, totalY)
      .text(`₱${(payment.amount / 100).toFixed(2)}`, 400, totalY, { width: 90, align: 'right' });

    // Payment method
    doc
      .fontSize(10)
      .text(`Payment Method: ${payment.method || 'PayMongo'}`, 50, totalY + 40);

    // Footer
    doc
      .fontSize(8)
      .text(
        'Thank you for your business!',
        50,
        700,
        { align: 'center', width: 500 }
      )
      .text(
        'If you have any questions, please contact support@gmailcleanup.ai',
        50,
        715,
        { align: 'center', width: 500 }
      );

    // Finalize PDF
    doc.end();

    logger.info(`Invoice ${invoiceId} downloaded by user ${req.user.email}`);

  } catch (error) {
    logger.error('Error generating invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice'
    });
  }
};

// ==================== NOTIFICATION SETTINGS ====================
exports.getNotificationSettings = async (req, res) => {
  try {
    const preferences = await UserPreferences.findOne({ userId: req.user._id });
    
    res.json({
      success: true,
      notifications: preferences?.notifications || getDefaultPreferences().notifications
    });
  } catch (error) {
    logger.error('Error fetching notification settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification settings'
    });
  }
};

exports.updateNotificationSettings = async (req, res) => {
  try {
    const { notifications } = req.body;
    
    const preferences = await UserPreferences.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { notifications } },
      { new: true, upsert: true }
    );

    res.json({
      success: true,
      message: 'Notification settings updated',
      notifications: preferences.notifications
    });
  } catch (error) {
    logger.error('Error updating notification settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification settings'
    });
  }
};

// Add this to controllers/settingsController.js
// Replace the testNotification function



exports.testNotification = async (req, res) => {
  try {
    const { type } = req.body; // 'email' or 'desktop' or 'both'
    
    const user = await User.findById(req.user._id);
    const preferences = await UserPreferences.findOne({ userId: req.user._id });

    if (!preferences) {
      return res.status(404).json({
        success: false,
        message: 'Preferences not found'
      });
    }

    const results = {
      email: null,
      desktop: null
    };

    // Send test email notification
    if (type === 'email' || type === 'both') {
      if (!preferences.emailNotifications) {
        results.email = 'Email notifications are disabled';
      } else {
        try {
          await emailNotificationService.sendEmail({
            to: user.email,
            subject: '🔔 Test Notification from Your Email Manager',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #4F46E5;">Test Notification</h2>
                <p>Hi ${user.name},</p>
                <p>This is a test notification to confirm your email notification settings are working correctly.</p>
                <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                  <h3 style="margin-top: 0; color: #374151;">Your Settings:</h3>
                  <ul style="color: #6B7280;">
                    <li>Email Notifications: ${preferences.emailNotifications ? '✅ Enabled' : '❌ Disabled'}</li>
                    <li>Desktop Notifications: ${preferences.desktopNotifications ? '✅ Enabled' : '❌ Disabled'}</li>
                    <li>Digest Frequency: ${preferences.digestFrequency}</li>
                    <li>Priority Emails Only: ${preferences.priorityEmailsOnly ? 'Yes' : 'No'}</li>
                  </ul>
                </div>
                <p>If you received this email, your notification settings are working perfectly! 🎉</p>
                <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
                <p style="color: #9CA3AF; font-size: 12px;">
                  This is a test notification sent at ${new Date().toLocaleString()}
                </p>
              </div>
            `
          });
          results.email = 'Test email sent successfully';
          logger.info(`Test email sent to ${user.email}`);
        } catch (emailError) {
          logger.error('Error sending test email:', emailError);
          results.email = `Failed to send: ${emailError.message}`;
        }
      }
    }

    // Send test desktop notification (via websocket or push notification)
    if (type === 'desktop' || type === 'both') {
      if (!preferences.desktopNotifications) {
        results.desktop = 'Desktop notifications are disabled';
      } else {
        try {
          // This would typically use WebSocket or Push API
          // For now, we'll just log it and send via any connected websocket
          const io = req.app.get('io'); // Assuming you have socket.io setup
          
          if (io) {
            io.to(req.user._id.toString()).emit('notification', {
              title: 'Test Notification',
              body: 'This is a test notification from your Email Manager',
              icon: '/notification-icon.png',
              timestamp: new Date(),
              data: {
                type: 'test',
                userId: req.user._id
              }
            });
            results.desktop = 'Test desktop notification sent';
            logger.info(`Test desktop notification sent to user ${req.user.email}`);
          } else {
            results.desktop = 'WebSocket not available';
          }
        } catch (desktopError) {
          logger.error('Error sending test desktop notification:', desktopError);
          results.desktop = `Failed to send: ${desktopError.message}`;
        }
      }
    }

    res.json({
      success: true,
      message: 'Test notification sent',
      results: results,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Error sending test notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification'
    });
  }
};

// ==================== EMAIL RULES ====================
exports.getEmailRules = async (req, res) => {
  try {
    const preferences = await UserPreferences.findOne({ userId: req.user._id });
    
    res.json({
      success: true,
      rules: preferences?.emailRules || []
    });
  } catch (error) {
    logger.error('Error fetching email rules:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email rules'
    });
  }
};

exports.createEmailRule = async (req, res) => {
  try {
    const { rule } = req.body;
    
    const preferences = await UserPreferences.findOne({ userId: req.user._id });
    
    if (!preferences.emailRules) {
      preferences.emailRules = [];
    }
    
    preferences.emailRules.push(rule);
    await preferences.save();

    res.json({
      success: true,
      message: 'Email rule created',
      rule
    });
  } catch (error) {
    logger.error('Error creating email rule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create email rule'
    });
  }
};

exports.updateEmailRule = async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { rule } = req.body;
    
    const preferences = await UserPreferences.findOne({ userId: req.user._id });
    
    const ruleIndex = preferences.emailRules.findIndex(r => r._id.toString() === ruleId);
    
    if (ruleIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Rule not found'
      });
    }
    
    preferences.emailRules[ruleIndex] = { ...preferences.emailRules[ruleIndex], ...rule };
    await preferences.save();

    res.json({
      success: true,
      message: 'Email rule updated'
    });
  } catch (error) {
    logger.error('Error updating email rule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update email rule'
    });
  }
};

exports.deleteEmailRule = async (req, res) => {
  try {
    const { ruleId } = req.params;
    
    const preferences = await UserPreferences.findOne({ userId: req.user._id });
    
    preferences.emailRules = preferences.emailRules.filter(r => r._id.toString() !== ruleId);
    await preferences.save();

    res.json({
      success: true,
      message: 'Email rule deleted'
    });
  } catch (error) {
    logger.error('Error deleting email rule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete email rule'
    });
  }
};

// ==================== DATA EXPORT ====================
// Add this to controllers/settingsController.js
// Replace exportUserData, getExportHistory, and downloadExport functions




// Create exports directory if it doesn't exist
const exportsDir = path.join(__dirname, '../exports');
if (!fs.existsSync(exportsDir)) {
  fs.mkdirSync(exportsDir, { recursive: true });
}

exports.exportUserData = async (req, res) => {
  try {
    const userId = req.user._id;
    const exportId = `export_${userId}_${Date.now()}`;
    const exportPath = path.join(exportsDir, `${exportId}.zip`);

    // Fetch all user data
    const [user, preferences, accounts, subscription, emails] = await Promise.all([
      User.findById(userId).select('-password').lean(),
      UserPreferences.findOne({ userId }).lean(),
      ConnectedAccount.find({ userId }).select('-accessToken -refreshToken').lean(),
      Subscription.findOne({ userId }).lean(),
      // Assuming you have an Email model
      mongoose.model('Email').find({ userId }).limit(10000).lean()
    ]);

    // Create export metadata
    const exportData = {
      exportId,
      exportDate: new Date(),
      user: {
        ...user,
        dataExportedAt: new Date()
      },
      preferences,
      connectedAccounts: accounts,
      subscription,
      emailsCount: emails?.length || 0,
      emails: emails || []
    };

    // Create ZIP archive
    const output = fs.createWriteStream(exportPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);

    // Add JSON files to archive
    archive.append(JSON.stringify(exportData, null, 2), { 
      name: 'user-data.json' 
    });

    archive.append(JSON.stringify(user, null, 2), { 
      name: 'profile.json' 
    });

    archive.append(JSON.stringify(preferences, null, 2), { 
      name: 'preferences.json' 
    });

    if (emails && emails.length > 0) {
      archive.append(JSON.stringify(emails, null, 2), { 
        name: 'emails.json' 
      });
    }

    // Create README
    const readme = `
# Your Data Export

Export ID: ${exportId}
Export Date: ${new Date().toISOString()}
User: ${user.email}

## Contents:
- user-data.json: Complete data export
- profile.json: Your profile information
- preferences.json: Your preferences and settings
- emails.json: Your email data (up to 10,000 emails)

This export was generated in compliance with GDPR data portability requirements.

If you have any questions, please contact support@yourcompany.com
    `;

    archive.append(readme, { name: 'README.txt' });

    await archive.finalize();

    // Wait for the output stream to finish
    output.on('close', async () => {
      logger.info(`Export created: ${exportId} (${archive.pointer()} bytes)`);

      // Save export record to user preferences or separate model
      if (!preferences.exportHistory) {
        preferences.exportHistory = [];
      }

      preferences.exportHistory.push({
        exportId,
        createdAt: new Date(),
        fileSize: archive.pointer(),
        status: 'completed'
      });

      await preferences.save();

      // Send notification email with download link
      await emailNotificationService.sendEmail({
        to: user.email,
        subject: '📦 Your Data Export is Ready',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Your Data Export is Ready!</h2>
            <p>Hi ${user.name},</p>
            <p>We've successfully generated your data export. You can download it from your settings page.</p>
            <div style="background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Export ID:</strong> ${exportId}</p>
              <p><strong>File Size:</strong> ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB</p>
              <p><strong>Created:</strong> ${new Date().toLocaleString()}</p>
            </div>
            <p>
              <a href="${process.env.FRONTEND_URL}/settings/exports" 
                 style="background: #4F46E5; color: white; padding: 12px 24px; 
                        text-decoration: none; border-radius: 6px; display: inline-block;">
                Download Export
              </a>
            </p>
            <p style="color: #6B7280; font-size: 14px;">
              Note: Export files are automatically deleted after 7 days.
            </p>
          </div>
        `
      });
    });

    res.json({
      success: true,
      message: 'Data export initiated. You will receive an email when ready.',
      exportId
    });

  } catch (error) {
    logger.error('Error exporting data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data'
    });
  }
};

exports.getExportHistory = async (req, res) => {
  try {
    const preferences = await UserPreferences.findOne({ userId: req.user._id });

    const exports = preferences?.exportHistory || [];

    // Check which exports are still available
    const exportsWithStatus = exports.map(exp => {
      const exportPath = path.join(exportsDir, `${exp.exportId}.zip`);
      const exists = fs.existsSync(exportPath);
      
      return {
        ...exp.toObject(),
        available: exists,
        downloadUrl: exists ? `/api/settings/exports/${exp.exportId}/download` : null
      };
    });

    res.json({
      success: true,
      exports: exportsWithStatus
    });
  } catch (error) {
    logger.error('Error fetching export history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch export history'
    });
  }
};

exports.downloadExport = async (req, res) => {
  try {
    const { exportId } = req.params;
    const exportPath = path.join(exportsDir, `${exportId}.zip`);

    // Verify export belongs to user
    const preferences = await UserPreferences.findOne({ userId: req.user._id });
    const exportRecord = preferences?.exportHistory?.find(
      exp => exp.exportId === exportId
    );

    if (!exportRecord) {
      return res.status(404).json({
        success: false,
        message: 'Export not found'
      });
    }

    // Check if file exists
    if (!fs.existsSync(exportPath)) {
      return res.status(404).json({
        success: false,
        message: 'Export file no longer available'
      });
    }

    // Send file
    res.download(exportPath, `${exportId}.zip`, (err) => {
      if (err) {
        logger.error('Error downloading export:', err);
        res.status(500).json({
          success: false,
          message: 'Failed to download export'
        });
      } else {
        logger.info(`Export ${exportId} downloaded by user ${req.user.email}`);
      }
    });

  } catch (error) {
    logger.error('Error downloading export:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download export'
    });
  }
};

// Cleanup old exports (run this as a cron job)
exports.cleanupOldExports = async () => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const files = fs.readdirSync(exportsDir);
    
    for (const file of files) {
      const filePath = path.join(exportsDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime < sevenDaysAgo) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted old export: ${file}`);
      }
    }
  } catch (error) {
    logger.error('Error cleaning up exports:', error);
  }
};

// INSTALLATION REQUIRED:
// npm install archiver
// ==================== ACCOUNT MANAGEMENT ====================
exports.getAccountInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    
    res.json({
      success: true,
      account: user
    });
  } catch (error) {
    logger.error('Error fetching account info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account info'
    });
  }
};

exports.updateAccountInfo = async (req, res) => {
  try {
    const { updates } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Account updated',
      account: user
    });
  } catch (error) {
    logger.error('Error updating account:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update account'
    });
  }
};

// Add this to controllers/settingsController.js
// Replace the deleteAccount function

exports.deleteAccount = async (req, res) => {
  try {
    const { confirmation, reason } = req.body;
    const userId = req.user._id;

    // Require explicit confirmation
    if (confirmation !== 'DELETE MY ACCOUNT') {
      return res.status(400).json({
        success: false,
        message: 'Please confirm account deletion by typing "DELETE MY ACCOUNT"'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    logger.info(`Account deletion initiated for user ${user.email}. Reason: ${reason || 'Not provided'}`);

    // Start deletion process
    const deletionResults = {
      user: false,
      preferences: false,
      connectedAccounts: false,
      subscription: false,
      emails: false,
      notifications: false
    };

    try {
      // 1. Cancel active subscription
      const subscription = await Subscription.findOne({ userId });
      if (subscription && subscription.status === 'active') {
        // Cancel with payment provider
        if (subscription.stripeSubscriptionId) {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
        }
        
        subscription.status = 'canceled';
        subscription.canceledAt = new Date();
        subscription.cancellationReason = reason || 'Account deletion';
        await subscription.save();
        deletionResults.subscription = true;
      }

      // 2. Revoke OAuth tokens for connected accounts
      const accounts = await ConnectedAccount.find({ userId });
      for (const account of accounts) {
        try {
          // Revoke Google OAuth token
          if (account.provider === 'google' && account.accessToken) {
            await fetch(`https://oauth2.googleapis.com/revoke?token=${account.accessToken}`, {
              method: 'POST'
            });
          }
          
          // Revoke Microsoft OAuth token
          if (account.provider === 'microsoft' && account.accessToken) {
            // Microsoft token revocation logic
          }
        } catch (revokeError) {
          logger.error(`Failed to revoke token for ${account.email}:`, revokeError);
        }
      }

      // 3. Delete connected accounts
      await ConnectedAccount.deleteMany({ userId });
      deletionResults.connectedAccounts = true;

      // 4. Delete user preferences
      await UserPreferences.deleteMany({ userId });
      deletionResults.preferences = true;

      // 5. Delete or anonymize emails (depending on your data retention policy)
      const Email = mongoose.model('Email');
      
      // Option A: Delete all emails
      await Email.deleteMany({ userId });
      
      // Option B: Anonymize emails (for legal/audit purposes)
      // await Email.updateMany(
      //   { userId },
      //   { 
      //     $set: { 
      //       userId: null, 
      //       anonymized: true,
      //       anonymizedAt: new Date() 
      //     } 
      //   }
      // );
      
      deletionResults.emails = true;

      // 6. Delete referrals
      const Referral = require('../models/Referral');
      await Referral.deleteMany({ referrerId: userId });
      await Referral.deleteMany({ referredUserId: userId });

      // 7. Delete beta signups
      const BetaSignup = require('../models/BetaSignup');
      await BetaSignup.deleteMany({ email: user.email });

      // 8. Delete email actions
      const EmailAction = require('../models/EmailAction');
      await EmailAction.deleteMany({ userId });

      // 9. Delete sender analytics
      const SenderAnalytics = require('../models/SenderAnalytics');
      await SenderAnalytics.deleteMany({ userId });

      // 10. Send goodbye email before deleting user
      try {
        await emailNotificationService.sendEmail({
          to: user.email,
          subject: 'Your Account Has Been Deleted',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Account Deletion Confirmed</h2>
              <p>Hi ${user.name},</p>
              <p>Your account has been successfully deleted from our system.</p>
              <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 15px; margin: 20px 0;">
                <p><strong>What's been deleted:</strong></p>
                <ul>
                  <li>Your profile and account information</li>
                  <li>All connected email accounts</li>
                  <li>Your preferences and settings</li>
                  <li>Email processing data</li>
                  <li>Subscription information</li>
                </ul>
              </div>
              <p>We're sorry to see you go. If you change your mind, you can always create a new account.</p>
              <p>If you have any questions or feedback about why you left, please reply to this email.</p>
              <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
              <p style="color: #6B7280; font-size: 12px;">
                Account deleted on ${new Date().toLocaleString()}
              </p>
            </div>
          `
        });
        deletionResults.notifications = true;
      } catch (emailError) {
        logger.error('Failed to send goodbye email:', emailError);
      }

      // 11. Finally, delete the user account
      await User.findByIdAndDelete(userId);
      deletionResults.user = true;

      logger.info(`Account successfully deleted for ${user.email}`);

      // Clear user session/token
      res.clearCookie('token');

      res.json({
        success: true,
        message: 'Account deleted successfully',
        deletionResults,
        deletedAt: new Date()
      });

    } catch (deletionError) {
      logger.error('Error during account deletion:', deletionError);
      
      // Rollback if possible
      return res.status(500).json({
        success: false,
        message: 'Account deletion failed. Please contact support.',
        partialResults: deletionResults,
        error: deletionError.message
      });
    }

  } catch (error) {
    logger.error('Error deleting account:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
};

// Optional: Schedule account for deletion (grace period)
exports.scheduleAccountDeletion = async (req, res) => {
  try {
    const { reason } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    
    // Set deletion date to 30 days from now
    user.scheduledDeletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    user.deletionReason = reason;
    user.accountStatus = 'pending_deletion';
    await user.save();

    // Send confirmation email
    await emailNotificationService.sendEmail({
      to: user.email,
      subject: 'Account Deletion Scheduled',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Account Deletion Scheduled</h2>
          <p>Hi ${user.name},</p>
          <p>Your account is scheduled for deletion on <strong>${user.scheduledDeletionDate.toLocaleDateString()}</strong>.</p>
          <p>You have 30 days to change your mind. If you'd like to keep your account, simply log in and cancel the deletion request.</p>
          <p>
            <a href="${process.env.FRONTEND_URL}/settings/account" 
               style="background: #4F46E5; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Cancel Deletion
            </a>
          </p>
        </div>
      `
    });

    res.json({
      success: true,
      message: 'Account scheduled for deletion in 30 days',
      scheduledDeletionDate: user.scheduledDeletionDate
    });

  } catch (error) {
    logger.error('Error scheduling account deletion:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule account deletion'
    });
  }
};

// Cancel scheduled deletion
exports.cancelAccountDeletion = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const user = await User.findById(userId);
    
    user.scheduledDeletionDate = null;
    user.deletionReason = null;
    user.accountStatus = 'active';
    await user.save();

    res.json({
      success: true,
      message: 'Account deletion cancelled'
    });

  } catch (error) {
    logger.error('Error canceling account deletion:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel account deletion'
    });
  }
};

// ==================== HELPER FUNCTIONS ====================
function getDefaultPreferences() {
  return {
    theme: 'light',
    compactMode: false,
    showEmailPreviews: true,
    emailsPerPage: 50,
    emailNotifications: true,
    desktopNotifications: false,
    priorityEmailsOnly: false,
    digestFrequency: 'daily',
    soundEnabled: true,
    autoArchiveRead: false,
    autoArchiveDays: 30,
    smartCategorization: true,
    autoLabelImportant: true,
    spamFilterLevel: 'medium',
    aiInsightsEnabled: true,
    autoSuggestReplies: true,
    smartFiltersEnabled: true,
    aiSummaryLength: 'medium',
    shareAnalytics: true,
    emailTracking: false,
    readReceipts: false,
    language: 'en',
    timezone: 'Asia/Manila',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h'
  };
}