const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const settingsController = require('../controllers/settingsController');

// ==================== PREFERENCES ROUTES ====================
// Get user preferences
router.get('/preferences', isAuthenticated, settingsController.getPreferences);

// Update user preferences
router.put('/preferences', isAuthenticated, settingsController.updatePreferences);

// Reset preferences to default
router.post('/preferences/reset', isAuthenticated, settingsController.resetPreferences);

// ==================== CONNECTED ACCOUNTS ROUTES ====================
// Get all connected accounts
router.get('/connected-accounts', isAuthenticated, settingsController.getConnectedAccounts);

// Disconnect an account
router.delete('/connected-accounts/:accountId', isAuthenticated, settingsController.disconnectAccount);

// Update account settings (e.g., permissions)
router.put('/connected-accounts/:accountId', isAuthenticated, settingsController.updateAccountSettings);

// Sync account data
router.post('/connected-accounts/:accountId/sync', isAuthenticated, settingsController.syncAccount);

// ==================== SUBSCRIPTION ROUTES ====================
// Get current subscription
router.get('/subscription/current', isAuthenticated, settingsController.getCurrentSubscription);

// Get payment history
router.get('/subscription/payment-history', isAuthenticated, settingsController.getPaymentHistory);

// Download invoice
router.get('/subscription/invoice/:invoiceId', isAuthenticated, settingsController.downloadInvoice);

// Cancel subscription
router.post('/subscription/cancel', isAuthenticated, settingsController.cancelSubscription);

// Reactivate subscription
router.post('/subscription/reactivate', isAuthenticated, settingsController.reactivateSubscription);

// Update payment method
router.put('/subscription/payment-method', isAuthenticated, settingsController.updatePaymentMethod);

// ==================== NOTIFICATION SETTINGS ====================
// Get notification settings
router.get('/notifications', isAuthenticated, settingsController.getNotificationSettings);

// Update notification settings
router.put('/notifications', isAuthenticated, settingsController.updateNotificationSettings);

// Test notification
router.post('/notifications/test', isAuthenticated, settingsController.testNotification);

// ==================== EMAIL RULES & FILTERS ====================
// Get email processing rules
router.get('/email-rules', isAuthenticated, settingsController.getEmailRules);

// Create email rule
router.post('/email-rules', isAuthenticated, settingsController.createEmailRule);

// Update email rule
router.put('/email-rules/:ruleId', isAuthenticated, settingsController.updateEmailRule);

// Delete email rule
router.delete('/email-rules/:ruleId', isAuthenticated, settingsController.deleteEmailRule);

// ==================== DATA EXPORT ====================
// Export user data
router.post('/export-data', isAuthenticated, settingsController.exportUserData);

// Get export history
router.get('/exports', isAuthenticated, settingsController.getExportHistory);

// Download export file
router.get('/exports/:exportId/download', isAuthenticated, settingsController.downloadExport);

// ==================== ACCOUNT MANAGEMENT ====================
// Get account info
router.get('/account', isAuthenticated, settingsController.getAccountInfo);

// Update account info
router.put('/account', isAuthenticated, settingsController.updateAccountInfo);

// Delete account
router.delete('/account', isAuthenticated, settingsController.deleteAccount);

module.exports = router;