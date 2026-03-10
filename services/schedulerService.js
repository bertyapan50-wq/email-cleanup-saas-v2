const cron = require('node-cron');
const Schedule = require('../models/Schedule');
const ScheduleLog = require('../models/ScheduleLog');

class SchedulerService {
  constructor() {
    this.isRunning = false;
  }

  start() {
    console.log('🚀 Starting email cleanup scheduler...');

    cron.schedule('* * * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️ Skipping - previous job still running');
        return;
      }

      this.isRunning = true;
      await this.checkAndExecuteSchedules();
      this.isRunning = false;
    });

    console.log('✅ Scheduler started! Checking every minute...');
  }

  async checkAndExecuteSchedules() {
    try {
      const dueSchedules = await Schedule.find({
        isActive: true,
        nextRun: { $lte: new Date() }
      }).populate('userId');

      if (dueSchedules.length === 0) {
        return;
      }

      console.log(`⏰ Found ${dueSchedules.length} due schedule(s)`);

      for (const schedule of dueSchedules) {
        await this.executeCleanup(schedule);
      }
    } catch (error) {
      console.error('❌ Scheduler error:', error);
    }
  }

  async executeCleanup(schedule) {
    const startTime = Date.now();
    let user = null;
    
    try {
      console.log(`🧹 Executing cleanup for user ${schedule.userId._id || schedule.userId}`);

      const User = require('../models/User');
      user = await User.findById(schedule.userId);
      
      if (!user) {
  console.warn(`⚠️ Skipping schedule ${schedule._id} — user not found`);
  await this.updateScheduleAfterRun(schedule, 0);
  return;
}

if (!user) {
  console.warn(`⚠️ Skipping — user not found for schedule ${schedule._id}`);
  await this.updateScheduleAfterRun(schedule, 0);
  return;
}

if (!user.googleTokens || !user.googleTokens.refresh_token) {
  console.warn(`⚠️ Skipping — ${user.email} has no Google tokens, needs to re-authenticate`);
  await this.updateScheduleAfterRun(schedule, 0);
  return;
}

      // ✅ Fetch emails from Gmail
      const gmailService = require('./gmailService');
      const emails = await gmailService.getInboxEmails(user.googleTokens, 100);
      
      if (!emails || emails.length === 0) {
        console.log('ℹ️ No emails in inbox to process');
        await this.logExecution(schedule, 0, 'success', null, Date.now() - startTime);
        await this.updateScheduleAfterRun(schedule, 0);
        
        // ✅ Send notification (no emails found)
        await this.sendNotification(user.email, {
          emailsProcessed: 0,
          action: schedule.action,
          executionTime: Date.now() - startTime,
          nextRun: schedule.nextRun,
          status: 'success'
        });
        
        return;
      }

      console.log(`📧 Found ${emails.length} emails in inbox`);

      // ✅ Simple rule-based analysis
      const recommendations = this.analyzeEmailsSimple(emails);
      
      console.log(`🤖 Analyzed ${recommendations.length} emails`);

      // ✅ Filter by confidence level
      let filtered = recommendations;
      if (schedule.confidenceLevel === 'high') {
        filtered = recommendations.filter(r => r.confidence >= 80);
      } else if (schedule.confidenceLevel === 'medium') {
        filtered = recommendations.filter(r => r.confidence >= 60);
      }

      // ✅ Filter by action type
      const emailsToProcess = filtered.filter(r => r.action === schedule.action);

      if (emailsToProcess.length === 0) {
        console.log(`ℹ️ No emails match criteria (${schedule.confidenceLevel} confidence, ${schedule.action} action)`);
        await this.logExecution(schedule, 0, 'success', null, Date.now() - startTime);
        await this.updateScheduleAfterRun(schedule, 0);
        
        // ✅ Send notification (no matches)
        await this.sendNotification(user.email, {
          emailsProcessed: 0,
          action: schedule.action,
          executionTime: Date.now() - startTime,
          nextRun: schedule.nextRun,
          status: 'success'
        });
        
        return;
      }

      const emailIds = emailsToProcess.map(r => r.emailId);
      console.log(`🎯 Processing ${emailIds.length} emails for ${schedule.action}`);

      // ✅ Execute action
      if (schedule.action === 'archive') {
        await gmailService.archiveEmails(user.googleTokens, emailIds);
        console.log(`📦 Successfully archived ${emailIds.length} emails`);
      } else if (schedule.action === 'delete') {
        await gmailService.deleteEmails(user.googleTokens, emailIds);
        console.log(`🗑️ Successfully deleted ${emailIds.length} emails`);
      }

      const executionTime = Date.now() - startTime;

      await this.logExecution(schedule, emailIds.length, 'success', null, executionTime);
      await this.updateScheduleAfterRun(schedule, emailIds.length);

      console.log(`✅ Cleanup completed: ${schedule.action}d ${emailIds.length} emails in ${executionTime}ms`);

      // ✅ ============================================
      // ✅ Send SUCCESS notification
      // ✅ ============================================
      await this.sendNotification(user.email, {
        emailsProcessed: emailIds.length,
        action: schedule.action,
        executionTime: executionTime,
        nextRun: schedule.nextRun,
        status: 'success'
      });

    } catch (error) {
      console.error(`❌ Cleanup failed:`, error.message);
      console.error(error.stack);
      
      const executionTime = Date.now() - startTime;
      await this.logExecution(schedule, 0, 'failed', error.message, executionTime);
      await this.updateScheduleAfterRun(schedule, 0);

      // ✅ ============================================
      // ✅ Send FAILURE notification
      // ✅ ============================================
      if (user && user.email) {
        await this.sendNotification(user.email, {
          emailsProcessed: 0,
          action: schedule.action,
          executionTime: executionTime,
          nextRun: schedule.nextRun,
          status: 'failed',
          errorMessage: error.message
        });
      }
    }
  }

  /**
   * Send email notification
   */
  async sendNotification(userEmail, cleanupData) {
    try {
      const emailNotificationService = require('./emailNotificationService');
      await emailNotificationService.sendCleanupNotification(userEmail, cleanupData);
      console.log(`📧 Notification sent to ${userEmail}`);
    } catch (error) {
      console.error('❌ Failed to send notification:', error.message);
      // Don't throw - notification failure shouldn't break the cleanup
    }
  }

  /**
   * Simple rule-based email analysis
   */
  analyzeEmailsSimple(emails) {
    const recommendations = [];

    for (const email of emails) {
      const { emailId, from, subject, snippet, date, labels = [] } = email;
      
      const ageInDays = this.calculateAge(date);
      const isUnread = labels.includes('UNREAD');
      const hasUnsubscribe = snippet?.toLowerCase().includes('unsubscribe') || false;
      const isPromo = this.isPromotional(from, subject, snippet);
      const isSocial = this.isSocialMedia(from, subject);
      const isNewsletter = this.isNewsletter(from, subject, snippet);
      const hasImportantKeywords = this.hasImportantKeywords(subject, snippet);
      
      let action = 'keep';
      let confidence = 50;
      let category = 'Other';
      let reason = '';
      
      if (hasImportantKeywords) {
        action = 'keep';
        confidence = 100;
        reason = 'Contains important keywords';
      }
      else if (isPromo && isUnread && ageInDays >= 30) {
        action = 'archive';
        confidence = 90;
        category = 'Promotional';
        reason = `Unread promotional email • ${ageInDays} days old`;
      }
      else if (isSocial && isUnread && ageInDays >= 7) {
        action = 'archive';
        confidence = 85;
        category = 'Social Media';
        reason = `Old social media notification • ${ageInDays} days old`;
      }
      else if (isNewsletter && isUnread && ageInDays >= 14) {
        action = 'archive';
        confidence = 80;
        category = 'Newsletter';
        reason = `Unread newsletter • ${ageInDays} days old`;
      }
      else if (isUnread && ageInDays >= 60) {
        action = 'archive';
        confidence = 75;
        category = 'Old Email';
        reason = `Very old unread email • ${ageInDays} days old`;
      }
      else if (hasUnsubscribe && ageInDays >= 90 && isUnread) {
        action = 'delete';
        confidence = 70;
        category = 'Promotional';
        reason = `Very old promotional email • ${ageInDays} days old • Has unsubscribe`;
      }
      
      if (action !== 'keep') {
        recommendations.push({
          emailId,
          from,
          subject,
          date,
          action,
          confidence,
          category,
          reason
        });
      }
    }

    return recommendations;
  }

  calculateAge(dateString) {
    try {
      const emailDate = new Date(dateString);
      const now = new Date();
      return Math.floor((now - emailDate) / (1000 * 60 * 60 * 24));
    } catch (error) {
      return 0;
    }
  }

  isPromotional(from, subject, snippet) {
    const text = `${from} ${subject} ${snippet}`.toLowerCase();
    const promoKeywords = ['sale', 'discount', 'offer', 'deal', 'promotion', 'free', 'limited time', '%off'];
    return promoKeywords.some(keyword => text.includes(keyword));
  }

  isSocialMedia(from, subject) {
    const text = `${from} ${subject}`.toLowerCase();
    const socialKeywords = ['facebook', 'linkedin', 'twitter', 'instagram', 'notification'];
    return socialKeywords.some(keyword => text.includes(keyword));
  }

  isNewsletter(from, subject, snippet) {
    const text = `${from} ${subject} ${snippet}`.toLowerCase();
    const newsletterKeywords = ['newsletter', 'digest', 'weekly', 'monthly', 'unsubscribe'];
    return newsletterKeywords.some(keyword => text.includes(keyword));
  }

  hasImportantKeywords(subject, snippet) {
    const text = `${subject} ${snippet}`.toLowerCase();
    const importantKeywords = [
      'invoice', 'payment', 'receipt', 'bill', 'charge',
      'urgent', 'important', 'action required', 'deadline',
      'legal', 'contract', 'password', 'security', 'verify',
      'meeting', 'interview', 'appointment'
    ];
    return importantKeywords.some(keyword => text.includes(keyword));
  }

  async logExecution(schedule, emailsProcessed, status, errorMessage, executionTime) {
    try {
      await ScheduleLog.create({
        scheduleId: schedule._id,
        userId: schedule.userId._id || schedule.userId,
        emailsProcessed,
        actionTaken: schedule.action,
        status,
        errorMessage,
        executionTimeMs: executionTime
      });
    } catch (error) {
      console.error('❌ Error logging execution:', error);
    }
  }

  async updateScheduleAfterRun(schedule, emailsProcessed) {
    try {
      const nextRun = this.calculateNextRun(
        schedule.scheduleType,
        schedule.time,
        schedule.dayOfWeek,
        schedule.dayOfMonth,
        schedule.timezone
      );

      schedule.nextRun = nextRun;
      schedule.lastRun = new Date();
      schedule.totalRuns = (schedule.totalRuns || 0) + 1;
      schedule.totalEmailsProcessed = (schedule.totalEmailsProcessed || 0) + emailsProcessed;
      
      await schedule.save();

      console.log(`📅 Next run scheduled for: ${nextRun.toLocaleString()}`);
    } catch (error) {
      console.error('❌ Error updating schedule:', error);
    }
  }

  calculateNextRun(type, time, dayOfWeek, dayOfMonth, timezone = 'Asia/Manila') {
    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    let next = new Date();
    
    next.setHours(hours, minutes, 0, 0);

    if (type === 'daily') {
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
    } else if (type === 'weekly') {
      const currentDay = next.getDay();
      const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
      next.setDate(next.getDate() + daysUntilTarget);
      
      if (next <= now) {
        next.setDate(next.getDate() + 7);
      }
    } else if (type === 'monthly') {
      next.setDate(dayOfMonth);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
    }

    return next;
  }
}

module.exports = new SchedulerService();