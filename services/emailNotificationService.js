const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailNotificationService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
    });
  }

  async sendBetaConfirmation(email, name) {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Welcome to Email Cleanup Beta! 🎉',
        html: `<h1>Welcome ${name}!</h1><p>Thank you for signing up for our beta program.</p><p>You'll get early access to our AI-powered email cleanup platform and a special 50% discount when we launch!</p><p>We'll keep you updated on our progress.</p>`
      });
      logger.info(`Beta confirmation sent to ${email}`);
    } catch (error) {
      logger.error('Email send error:', error);
    }
  }

  async sendSubscriptionUpdate(email, status, plan) {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Subscription Update',
        html: `<h1>Subscription Update</h1><p>Your subscription status has been updated to: ${status}</p><p>Plan: ${plan}</p>`
      });
    } catch (error) {
      logger.error('Email send error:', error);
    }
  }

  async sendReferralReward(email, rewardType, data = {}) {
    try {
      let subject, html;
      
      if (rewardType === 'credit') {
        subject = '🎉 You Earned Referral Credits!';
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">🎉 Congratulations!</h1>
            </div>
            
            <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <h2 style="color: #1f2937; margin-top: 0;">You Earned ${data.amount || '$2.00'} in Referral Credits! 💰</h2>
              
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
                Great news! Someone you referred just subscribed to Gmail Cleanup AI Premium!
              </p>
              
              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; color: #1f2937; font-weight: bold;">💳 Your Referral Credits:</p>
                <p style="margin: 5px 0 0 0; font-size: 24px; color: #667eea; font-weight: bold;">${data.amount || '$2.00'}</p>
                <p style="margin: 10px 0 0 0; color: #6b7280; font-size: 14px;">Use these credits towards your next subscription payment!</p>
              </div>
              
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
                Keep sharing your referral link to earn up to <strong>$50/year</strong> in credits!
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL}/referrals" 
                   style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                          color: white; 
                          padding: 15px 30px; 
                          text-decoration: none; 
                          border-radius: 8px; 
                          font-weight: bold;
                          display: inline-block;">
                  View Your Referrals
                </a>
              </div>
              
              <p style="color: #9ca3af; font-size: 14px; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
                Questions? Reply to this email or visit our <a href="${process.env.FRONTEND_URL}/support" style="color: #667eea;">support page</a>.
              </p>
            </div>
          </div>
        `;
      } else {
        const rewards = { 
          month_free: '1 Month Free', 
          year_free: '1 Year Free', 
          lifetime_premium: 'Lifetime Premium Access' 
        };
        subject = '🎁 Referral Reward Unlocked!';
        html = `
          <h1>Congratulations! 🎉</h1>
          <p>You've unlocked a reward: <strong>${rewards[rewardType]}</strong></p>
          <p>Thank you for spreading the word about Gmail Cleanup AI!</p>
        `;
      }
      
      await this.transporter.sendMail({
        from: `Gmail Cleanup AI <${process.env.EMAIL_USER}>`,
        to: email,
        subject: subject,
        html: html
      });
      
      logger.info(`✅ Referral reward email sent to ${email} (${rewardType})`);
    } catch (error) {
      logger.error('❌ Failed to send referral reward email:', error);
    }
  }

  // ✅ ============================================
  // ✅ NEW: Auto-Cleanup Notification
  // ✅ ============================================
  async sendCleanupNotification(userEmail, cleanupData) {
    try {
      const {
        emailsProcessed,
        action,
        executionTime,
        nextRun,
        status,
        errorMessage
      } = cleanupData;

      const actionEmoji = action === 'archive' ? '📦' : '🗑️';
      const actionText = action === 'archive' ? 'Archived' : 'Deleted';
      const statusColor = status === 'success' ? '#10b981' : '#ef4444';
      const statusEmoji = status === 'success' ? '✅' : '❌';

      const subject = status === 'success' 
        ? `${statusEmoji} Auto-Cleanup Complete: ${emailsProcessed} emails ${actionText.toLowerCase()}`
        : `⚠️ Auto-Cleanup Failed`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f3f4f6;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: ${statusColor}; margin: 0; font-size: 28px;">
                ${statusEmoji} Auto-Cleanup ${status === 'success' ? 'Complete' : 'Failed'}
              </h1>
              <div style="display: inline-block; background: ${statusColor}; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold; margin-top: 12px;">
                ${status === 'success' ? 'Success' : 'Failed'}
              </div>
            </div>

            ${status === 'success' ? `
              <!-- Success Content -->
              <div style="text-align: center;">
                <div style="font-size: 48px; color: ${statusColor}; margin: 20px 0;">
                  ${actionEmoji} ${emailsProcessed}
                </div>
                <p style="font-size: 18px; color: #6b7280; margin: 0;">
                  emails ${actionText.toLowerCase()}
                </p>
              </div>

              <!-- Stats -->
              <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                  <span style="color: #6b7280; font-weight: 500;">Action Taken</span>
                  <span style="color: #111827; font-weight: 600;">${actionEmoji} ${actionText}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                  <span style="color: #6b7280; font-weight: 500;">Emails Processed</span>
                  <span style="color: #111827; font-weight: 600;">${emailsProcessed}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 12px 0;">
                  <span style="color: #6b7280; font-weight: 500;">Execution Time</span>
                  <span style="color: #111827; font-weight: 600;">${(executionTime / 1000).toFixed(2)}s</span>
                </div>
              </div>

              ${emailsProcessed > 0 ? `
                <p style="text-align: center; color: #6b7280; background: #eff6ff; padding: 12px; border-radius: 8px; margin: 16px 0;">
                  ${action === 'archive' 
                    ? '✅ Your emails are safely archived in "All Mail"' 
                    : '⚠️ Your emails are in Trash (30-day recovery period)'}
                </p>
              ` : `
                <p style="text-align: center; color: #6b7280; background: #f3f4f6; padding: 12px; border-radius: 8px; margin: 16px 0;">
                  ℹ️ No emails matched your cleanup criteria this time
                </p>
              `}

              <!-- Next Run -->
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px; border-radius: 8px; text-align: center; margin: 24px 0;">
                <p style="margin: 0; font-size: 14px; opacity: 0.9;">📅 Next Scheduled Cleanup</p>
                <p style="margin: 8px 0 0 0; font-size: 18px; font-weight: bold;">${new Date(nextRun).toLocaleString()}</p>
              </div>

              <!-- View Dashboard Button -->
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL}/dashboard" 
                   style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                  View Dashboard
                </a>
              </div>
            ` : `
              <!-- Failure Content -->
              <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 16px; margin: 16px 0; border-radius: 4px;">
                <p style="margin: 0; color: #991b1b; font-weight: 600;">❌ Cleanup Failed</p>
                <p style="margin: 8px 0 0 0; color: #991b1b;">${errorMessage || 'An error occurred during cleanup'}</p>
              </div>

              <p style="color: #6b7280; text-align: center;">
                Don't worry - we'll try again at the next scheduled time.
              </p>

              <div style="text-align: center; margin: 20px 0;">
                <a href="${process.env.FRONTEND_URL}/support" 
                   style="color: #667eea; text-decoration: none; font-weight: 600;">
                  Contact Support →
                </a>
              </div>
            `}

            <!-- Footer -->
            <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
              <p style="margin: 0;">
                This is an automated notification from your Smart Email Cleanup schedule.
              </p>
              <p style="margin: 8px 0 0 0;">
                <a href="${process.env.FRONTEND_URL}/settings" style="color: #667eea; text-decoration: none;">Manage Schedule</a> | 
                <a href="${process.env.FRONTEND_URL}/settings" style="color: #667eea; text-decoration: none;">Unsubscribe</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      await this.transporter.sendMail({
        from: `Gmail Cleanup AI <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: subject,
        html: html
      });

      logger.info(`✅ Cleanup notification sent to ${userEmail}`);
      return { success: true };
      
    } catch (error) {
      logger.error('❌ Failed to send cleanup notification:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailNotificationService();