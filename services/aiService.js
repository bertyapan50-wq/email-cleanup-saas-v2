const logger = require('../utils/logger');
const SenderAnalytics = require('../models/SenderAnalytics');
const EmailAction = require('../models/EmailAction');

class SmartAIService {
  constructor() {
    // AI Configuration
    this.config = {
      minGroupSize: 3, // Minimum emails to form a group
      minConfidenceForDelete: 0.95, // VERY HIGH confidence required for delete
      
      // Age thresholds (days)
      oldEmailThreshold: 30,
      veryOldEmailThreshold: 90,
      
      // Safety rules
      safetyRules: {
        neverDeleteIfReplied: true,
        neverDeleteHumanSenders: true,
        neverDeleteImportantKeywords: true,
        recentEmailThreshold: 7 // Don't delete emails less than 7 days old
      }
    };
    
    // Importance keywords (NEVER suggest delete if present)
    this.importanceKeywords = [
      'invoice', 'payment', 'receipt', 'bill', 'charge', 'transaction',
      'urgent', 'important', 'action required', 'deadline', 'due',
      'legal', 'contract', 'agreement', 'terms', 'policy',
      'confirm', 'verification', 'security', 'password', 'account',
      'meeting', 'schedule', 'appointment', 'interview'
    ];
    
    // Promotional/Low importance patterns
    this.lowImportancePatterns = [
      'unsubscribe', 'opt out', 'marketing', 'promotion', 'sale',
      'discount', 'offer', 'deal', 'free', 'limited time',
      'newsletter', 'digest', 'update', 'weekly', 'monthly'
    ];
  }

  /**
   * MAIN: Analyze emails and create grouped suggestions
   */
  async analyzeEmailsGrouped(emails, userId) {
    try {
      logger.info(`🧠 Starting smart analysis for ${emails.length} emails`);
      
      // Step 1: Analyze each email individually
      const analyzedEmails = [];
      for (const email of emails) {
        const analyzed = await this.analyzeEmail(email, userId);
        if (analyzed) {
          analyzedEmails.push(analyzed);
        }
      }
      
      // Step 2: Group emails by sender domain and category
      const groups = this.groupEmails(analyzedEmails);
      
      // Step 3: Create suggestions for each group
      const suggestions = this.createGroupSuggestions(groups);
      
      logger.info(`✅ Created ${suggestions.length} suggestion groups`);
      
      return {
        suggestions,
        statistics: {
          totalAnalyzed: emails.length,
          totalGroups: suggestions.length,
          highConfidence: suggestions.filter(s => s.confidence === 'VERY_HIGH' || s.confidence === 'HIGH').length,
          safeToAct: suggestions.filter(s => s.safety_check.is_safe).length
        }
      };
    } catch (error) {
      logger.error('Smart analysis error:', error);
      return { suggestions: [], statistics: {} };
    }
  }

  /**
   * Analyze single email with safety checks
   */
  async analyzeEmail(emailMetadata, userId) {
    try {
      const { id, sender, from, subject, snippet, date, labels = [], replied = false } = emailMetadata;
      
      // Use 'from' if 'sender' is not available
      const emailSender = sender || from || 'Unknown';
      
      // Extract domain
      const senderDomain = this.extractDomain(emailSender);
      
      // Get sender analytics
      const senderAnalytics = await this.getSenderAnalytics(userId, emailSender, senderDomain);
      
      // Calculate age
      const ageInDays = this.calculateAge(date);
      
      // Detect email characteristics
      const isUnopened = labels.includes('UNREAD');
      const hasUnsubscribeLink = snippet?.toLowerCase().includes('unsubscribe');
      const isHumanSender = this.detectHumanSender(emailSender, senderAnalytics);
      const hasImportantKeywords = this.detectImportantKeywords(subject, snippet);
      const hasLowImportancePatterns = this.detectLowImportance(subject, snippet);
      
      // Importance score
      const importanceScore = this.calculateImportance({
        replied,
        isHumanSender,
        hasImportantKeywords,
        senderAnalytics,
        ageInDays,
        isUnopened
      });
      
      // Safety checks
      const safetyCheck = this.performSafetyChecks({
        replied,
        isHumanSender,
        hasImportantKeywords,
        ageInDays,
        senderAnalytics
      });
      
      return {
        id,
        sender: emailSender,
        senderDomain,
        subject,
        snippet,
        date,
        ageInDays,
        replied,
        isUnopened,
        hasUnsubscribeLink,
        isHumanSender,
        hasImportantKeywords,
        hasLowImportancePatterns,
        importanceScore,
        safetyCheck,
        category: senderAnalytics.category || this.categorizeEmail(emailSender, subject),
        senderAnalytics
      };
    } catch (error) {
      logger.error('Email analysis error:', error);
      return null;
    }
  }

  /**
   * Group emails by sender domain and category
   */
  groupEmails(analyzedEmails) {
    const groups = {};
    
    analyzedEmails.forEach(email => {
      if (!email) return;
      
      // Group by sender domain
      const groupKey = `${email.senderDomain}|${email.category}`;
      
      if (!groups[groupKey]) {
        groups[groupKey] = {
          senderDomain: email.senderDomain,
          category: email.category,
          emails: []
        };
      }
      
      groups[groupKey].emails.push(email);
    });
    
    // Filter groups with minimum size
    return Object.values(groups).filter(g => g.emails.length >= this.config.minGroupSize);
  }

  /**
   * Create suggestions for each group
   */
  createGroupSuggestions(groups) {
    const suggestions = [];
    
    groups.forEach(group => {
      const { senderDomain, category, emails } = group;
      
      // Calculate group metrics
      const allUnopened = emails.every(e => e.isUnopened);
      const allOld = emails.every(e => e.ageInDays >= this.config.oldEmailThreshold);
      const averageAge = emails.reduce((sum, e) => sum + e.ageInDays, 0) / emails.length;
      const hasUnsubscribe = emails.some(e => e.hasUnsubscribeLink);
      const allSafe = emails.every(e => e.safetyCheck.is_safe);
      const allLowImportance = emails.every(e => e.importanceScore < 0.3);
      
      // Determine action and confidence
      let suggestedActions = [];
      let confidence = 'LOW';
      let reasons = [];
      
      // Build reasons
      if (allUnopened && averageAge >= this.config.oldEmailThreshold) {
        reasons.push('unopened_30_plus_days');
      }
      if (emails.length >= 5) {
        reasons.push('recurring_sender');
      }
      if (allLowImportance) {
        reasons.push('low_user_engagement');
      }
      if (hasUnsubscribe) {
        reasons.push('promotional_content');
      }
      
      // Determine action based on safety and metrics
      if (!allSafe) {
        // Some emails are not safe to act on
        suggestedActions = [];
        confidence = 'LOW';
        reasons.push('contains_important_emails');
      } else {
        // Safe to suggest actions
        if (allUnopened && allOld && allLowImportance) {
          // VERY HIGH confidence for archive
          suggestedActions = ['ARCHIVE_ALL'];
          confidence = 'VERY_HIGH';
          
          // Only suggest delete if EXTREMELY confident
          if (averageAge >= this.config.veryOldEmailThreshold && category === 'Promotion') {
            suggestedActions.push('DELETE_ALL');
            confidence = 'VERY_HIGH';
          }
        } else if (allUnopened && allOld) {
          // HIGH confidence for archive
          suggestedActions = ['ARCHIVE_ALL'];
          confidence = 'HIGH';
        } else if (hasUnsubscribe && allLowImportance) {
          // MEDIUM confidence for mute/unsubscribe
          suggestedActions = ['ARCHIVE_ALL', 'MUTE_SENDER'];
          confidence = 'MEDIUM';
        } else {
          // LOW confidence - just archive
          suggestedActions = ['ARCHIVE_ALL'];
          confidence = 'LOW';
        }
      }
      
      // Create suggestion object
      if (suggestedActions.length > 0) {
        suggestions.push({
          title: `${emails.length} emails from ${senderDomain}`,
          emails_count: emails.length,
          sender_or_category: senderDomain,
          category: category,
          suggested_actions: suggestedActions,
          confidence: confidence,
          reasons: reasons,
          safety_note: 'You can undo this action from Archive',
          safety_check: {
            is_safe: allSafe,
            unsafe_count: emails.filter(e => !e.safetyCheck.is_safe).length
          },
          email_ids: emails.map(e => e.id),
          emails: emails.map(e => ({
            id: e.id,
            subject: e.subject,
            from: e.sender,
            date: e.date,
            ageInDays: e.ageInDays,
            isUnopened: e.isUnopened
          })),
          metadata: {
            averageAge: Math.round(averageAge),
            allUnopened,
            hasUnsubscribe,
            category
          }
        });
      }
    });
    
    // Sort by confidence (highest first)
    const confidenceOrder = { 'VERY_HIGH': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    suggestions.sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);
    
    return suggestions;
  }

  /**
   * Calculate importance score (0-1, higher = more important)
   */
  calculateImportance(factors) {
    let score = 0;
    
    // Replied to = HIGH importance
    if (factors.replied) score += 0.4;
    
    // Human sender = HIGH importance
    if (factors.isHumanSender) score += 0.3;
    
    // Important keywords = HIGH importance
    if (factors.hasImportantKeywords) score += 0.3;
    
    // Sender analytics
    if (factors.senderAnalytics) {
      score += factors.senderAnalytics.importanceScore * 0.2;
    }
    
    // Recent emails = more important
    if (factors.ageInDays < 7) score += 0.2;
    else if (factors.ageInDays < 30) score += 0.1;
    
    // Opened emails = more important
    if (!factors.isUnopened) score += 0.1;
    
    return Math.min(1, score);
  }

  /**
   * Safety checks - NEVER suggest action if fails
   */
  performSafetyChecks(factors) {
    // Check 1: Replied to
    if (this.config.safetyRules.neverDeleteIfReplied && factors.replied) {
      return {
        is_safe: false,
        failed_check: 'replied_to',
        reason: 'User has replied to this email - HIGH importance'
      };
    }
    
    // Check 2: Human sender
    if (this.config.safetyRules.neverDeleteHumanSenders && factors.isHumanSender) {
      return {
        is_safe: false,
        failed_check: 'human_sender',
        reason: 'Email from real person - HIGH importance'
      };
    }
    
    // Check 3: Important keywords
    if (this.config.safetyRules.neverDeleteImportantKeywords && factors.hasImportantKeywords) {
      return {
        is_safe: false,
        failed_check: 'important_keywords',
        reason: 'Contains invoice/payment/urgent keywords - HIGH importance'
      };
    }
    
    // Check 4: Recent emails
    if (factors.ageInDays < this.config.safetyRules.recentEmailThreshold) {
      return {
        is_safe: false,
        failed_check: 'too_recent',
        reason: 'Email too recent - wait before cleanup'
      };
    }
    
    // Check 5: Protected sender
    if (factors.senderAnalytics?.isProtected) {
      return {
        is_safe: false,
        failed_check: 'protected_sender',
        reason: 'Sender is marked as VIP/Protected'
      };
    }
    
    // All checks passed
    return {
      is_safe: true,
      passed_checks: ['replied', 'human_sender', 'keywords', 'age', 'protected']
    };
  }

  /**
   * Detect if sender is a human (not automated)
   */
  detectHumanSender(sender, senderAnalytics) {
    const email = sender.toLowerCase();
    
    // Automated patterns
    const automatedPatterns = ['noreply', 'no-reply', 'donotreply', 'automated', 'bot', 'notification'];
    if (automatedPatterns.some(p => email.includes(p))) return false;
    
    // Check sender analytics
    if (senderAnalytics && senderAnalytics.category === 'Personal') return true;
    if (senderAnalytics && senderAnalytics.replyRate > 0) return true;
    
    return false;
  }

  /**
   * Detect important keywords in subject/snippet
   */
  detectImportantKeywords(subject = '', snippet = '') {
    const text = `${subject} ${snippet}`.toLowerCase();
    return this.importanceKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Detect low importance patterns
   */
  detectLowImportance(subject = '', snippet = '') {
    const text = `${subject} ${snippet}`.toLowerCase();
    return this.lowImportancePatterns.some(pattern => text.includes(pattern));
  }

  /**
   * Categorize email based on sender/subject
   */
  categorizeEmail(sender, subject) {
    const email = sender.toLowerCase();
    const sub = subject.toLowerCase();
    
    if (email.includes('noreply') || sub.includes('newsletter')) return 'Newsletter';
    if (sub.includes('promotion') || sub.includes('sale') || sub.includes('discount')) return 'Promotion';
    if (email.includes('linkedin') || email.includes('facebook')) return 'Social';
    if (sub.includes('job') || sub.includes('hiring')) return 'Job Alert';
    
    return 'Unknown';
  }

  /**
   * Get or create sender analytics
   */
  async getSenderAnalytics(userId, senderEmail, senderDomain) {
    try {
      let analytics = await SenderAnalytics.findOne({ userId, senderEmail });
      
      if (!analytics) {
        analytics = await SenderAnalytics.create({
          userId,
          senderEmail,
          senderDomain,
          totalEmails: 1
        });
        analytics.autoCategorizeSender();
        await analytics.save();
      }
      
      return analytics;
    } catch (error) {
      logger.error('Error getting sender analytics:', error);
      return {
        category: 'Unknown',
        importanceScore: 0.5,
        openRate: 0,
        replyRate: 0,
        isProtected: false
      };
    }
  }

  /**
   * Learn from user feedback
   */
  async learnFromFeedback(userId, emailActionId, userAgreed, userAction) {
    try {
      const emailAction = await EmailAction.findById(emailActionId);
      if (!emailAction) return;
      
      emailAction.recordFeedback(userAgreed, userAction);
      await emailAction.save();
      
      // Update sender analytics
      if (emailAction.metadata?.sender) {
        const analytics = await SenderAnalytics.findOne({ 
          userId, 
          senderEmail: emailAction.metadata.sender 
        });
        
        if (analytics) {
          if (userAction === 'delete' || userAction === 'archive') {
            analytics.emailsArchived += 1;
          }
          if (userAgreed) {
            // AI was correct, increase trust
            analytics.importanceScore = Math.max(0, analytics.importanceScore - 0.1);
          } else {
            // AI was wrong, increase importance
            analytics.importanceScore = Math.min(1, analytics.importanceScore + 0.2);
          }
          analytics.updateMetrics();
          await analytics.save();
        }
      }
      
      logger.info(`✅ AI learned from feedback: agreed=${userAgreed}, action=${userAction}`);
    } catch (error) {
      logger.error('Error learning from feedback:', error);
    }
  }

  // Helper methods
  extractDomain(email) {
    const match = email.match(/@(.+?)>/);
    return match ? match[1] : email.split('@')[1]?.split('>')[0] || 'unknown';
  }

  calculateAge(dateString) {
    const emailDate = new Date(dateString);
    const now = new Date();
    return Math.floor((now - emailDate) / (1000 * 60 * 60 * 24));
  }
}

module.exports = new SmartAIService();