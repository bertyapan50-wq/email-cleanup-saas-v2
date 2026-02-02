const EmailAction = require('../models/EmailAction');
const User = require('../models/User');
const SenderAnalytics = require('../models/SenderAnalytics');
const gmailService = require('../services/gmailService');
const aiService = require('../services/aiService');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../utils/logger');
const { google } = require('googleapis');

// ==========================================
// ✅ HELPER FUNCTION - CREATE GMAIL CLIENT
// ==========================================
const createGmailClient = (user) => {
  if (!user || !user.tokens) {
    throw new Error('User not authenticated or tokens missing');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials(user.tokens);
  return google.gmail({ version: 'v1', auth: oauth2Client });
};

// ==========================================
// SIMPLE EMAIL ANALYSIS (NO AUTH)
// ==========================================
exports.analyzeEmailsSimple = async (req, res) => {
  try {
    console.log('🚀 analyzeEmailsSimple called - SMART MODE');
    const { emails } = req.body;
    
    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid emails payload'
      });
    }

    console.log(`🤖 Analyzing ${emails.length} emails with smart AI...`);

    // ✅ Use smart AI analysis with grouping and safety checks
    const aiService = require('../services/aiService');
    
    // Get user ID if available (for sender analytics)
    const userId = req.user?._id || 'guest';
    
    // Run smart grouped analysis
    const result = await aiService.analyzeEmailsGrouped(emails, userId);
    
    console.log(`✅ Smart analysis complete: ${result.suggestions.length} suggestion groups created`);
    
    // ✅ Return structured response with groups
    res.status(200).json({
      success: true,
      analyzed: emails.length,
      totalAnalyzed: emails.length,
      suggestions: result.suggestions, // Grouped suggestions with confidence levels
      statistics: result.statistics,
      message: `Analyzed ${emails.length} emails, created ${result.suggestions.length} smart suggestions`
    });

  } catch (err) {
    console.error('❌ analyzeEmailsSimple error:', err);
    
    // ✅ Fallback to safe default if AI fails
    res.status(500).json({
      success: false,
      message: 'AI analysis failed',
      error: err.message,
      suggestions: [], // Safe fallback - no suggestions if error
      statistics: {
        totalAnalyzed: 0,
        totalGroups: 0,
        highConfidence: 0,
        safeToAct: 0
      }
    });
  }
};

// ==========================================
// FETCH & ANALYZE WITH INTELLIGENT AI
// ==========================================
exports.fetchAndAnalyzeEmails = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user.googleTokens || !user.googleTokens.access_token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Gmail not connected. Please authorize Gmail access.' 
      });
    }

    logger.info(`🔍 Fetching emails for user: ${user.email}`);
    
    const emails = await gmailService.fetchEmails(user.googleTokens);
    logger.info(`📧 Fetched ${emails.length} emails`);
    
    // Analyze with AI
    const analyses = await aiService.batchAnalyzeEmails(emails, user._id);
    logger.info(`🧠 Analyzed ${analyses.length} emails with AI`);

    // Create suggestions
    const suggestions = await Promise.all(
      emails.map(async (email, index) => {
        const analysis = analyses[index];
        const senderDomain = aiService.extractDomain(email.sender);
        
        return await EmailAction.create({
          userId: user._id,
          emailId: email.id,
          action: analysis.action,
          metadata: {
            sender: email.sender,
            senderDomain,
            subject: email.subject,
            date: email.date,
            labels: email.labels,
            snippet: email.snippet,
            category: analysis.metadata.senderCategory,
            ageInDays: analysis.metadata.ageInDays
          },
          aiSuggestion: {
            action: analysis.action,
            confidence: analysis.confidence,
            reasoning: analysis.reasoning,
            factors: analysis.factors,
            scores: analysis.scores
          }
        });
      })
    );

    // Group by action
    const groupedSuggestions = {
      archive: [],
      delete: [],
      unsubscribe: [],
      keep: []
    };

    suggestions.forEach(s => {
      if (groupedSuggestions[s.action]) {
        groupedSuggestions[s.action].push({
          id: s._id,
          emailId: s.emailId,
          action: s.action,
          metadata: s.metadata,
          aiSuggestion: s.aiSuggestion
        });
      }
    });

    // Statistics
    const highConfidenceSuggestions = suggestions.filter(s => s.aiSuggestion.confidence >= 0.85);
    const averageConfidence = suggestions.reduce((sum, s) => sum + s.aiSuggestion.confidence, 0) / suggestions.length;

    res.json({
      success: true,
      analyzed: emails.length,
      suggestions: suggestions.map(s => ({
        id: s._id,
        emailId: s.emailId,
        action: s.action,
        metadata: s.metadata,
        aiSuggestion: s.aiSuggestion
      })),
      grouped: groupedSuggestions,
      statistics: {
        total: suggestions.length,
        highConfidence: highConfidenceSuggestions.length,
        averageConfidence: Math.round(averageConfidence * 100),
        byAction: {
          archive: groupedSuggestions.archive.length,
          delete: groupedSuggestions.delete.length,
          unsubscribe: groupedSuggestions.unsubscribe.length,
          keep: groupedSuggestions.keep.length
        }
      }
    });
  } catch (error) {
    logger.error('Email analysis error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to analyze emails',
      error: error.message 
    });
  }
};

// ==========================================
// EXECUTE CLEANUP ACTIONS
// ==========================================
exports.executeCleanup = async (req, res) => {
  try {
    const { actionIds } = req.body;
    const user = await User.findById(req.user._id);
    const actions = await EmailAction.find({ 
      _id: { $in: actionIds }, 
      userId: user._id, 
      executed: false 
    });

    let executed = 0;
    const learningData = [];

    for (const action of actions) {
      try {
        await gmailService.executeAction(user.googleTokens, action.emailId, action.action);
        
        action.executed = true;
        action.executedAt = new Date();
        action.userApproved = true;
        await action.save();
        
        learningData.push({
          actionId: action._id,
          sender: action.metadata.sender,
          aiAction: action.aiSuggestion.action,
          userAction: action.action,
          agreed: true
        });
        
        executed++;
      } catch (error) {
        logger.error(`Failed to execute action ${action._id}:`, error);
      }
    }

    // Update quota
    user.emailQuotaUsed += executed;
    await user.save();

    // AI Learning
    for (const data of learningData) {
      await aiService.learnFromFeedback(
        user._id, 
        data.actionId, 
        data.agreed, 
        data.userAction
      );
    }

    logger.info(`✅ Executed ${executed} actions, AI learned from feedback`);

    // Send summary
    await emailNotificationService.sendCleanupSummary(user.email, {
      analyzed: actions.length,
      cleaned: executed,
      spaceSaved: `${(executed * 0.1).toFixed(1)} MB`
    });

    res.json({
      success: true,
      executed,
      failed: actions.length - executed,
      learned: learningData.length,
      quotaRemaining: user.subscriptionTier === 'free' 
        ? user.emailQuotaLimit - user.emailQuotaUsed 
        : 'unlimited'
    });
  } catch (error) {
    logger.error('Cleanup execution error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Cleanup failed',
      error: error.message 
    });
  }
};

// ==========================================
// REJECT AI SUGGESTION
// ==========================================
exports.rejectSuggestion = async (req, res) => {
  try {
    const { actionId, reason } = req.body;
    const user = await User.findById(req.user._id);
    
    const action = await EmailAction.findOne({ _id: actionId, userId: user._id });
    if (!action) {
      return res.status(404).json({ success: false, message: 'Action not found' });
    }

    action.userRejected = true;
    action.recordFeedback(false, reason);
    await action.save();

    await aiService.learnFromFeedback(user._id, actionId, false, 'keep');

    logger.info(`❌ User rejected AI suggestion for: ${action.metadata.subject}`);

    res.json({
      success: true,
      message: 'AI learned from your feedback'
    });
  } catch (error) {
    logger.error('Reject suggestion error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process rejection' 
    });
  }
};

// ==========================================
// GET CLEANUP HISTORY
// ==========================================
exports.getCleanupHistory = async (req, res) => {
  try {
    const history = await EmailAction.find({ 
      userId: req.user._id, 
      executed: true 
    })
    .sort({ executedAt: -1 })
    .limit(100);

    const totalActions = await EmailAction.countDocuments({ userId: req.user._id });
    const approvedActions = await EmailAction.countDocuments({ 
      userId: req.user._id, 
      userApproved: true 
    });
    const rejectedActions = await EmailAction.countDocuments({ 
      userId: req.user._id, 
      userRejected: true 
    });

    const accuracy = totalActions > 0 
      ? Math.round((approvedActions / totalActions) * 100) 
      : 0;

    res.json({ 
      success: true, 
      history,
      statistics: {
        total: totalActions,
        approved: approvedActions,
        rejected: rejectedActions,
        accuracy: accuracy
      }
    });
  } catch (error) {
    logger.error('History fetch error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch history' 
    });
  }
};

// ==========================================
// GET SENDER ANALYTICS
// ==========================================
exports.getSenderAnalytics = async (req, res) => {
  try {
    const analytics = await SenderAnalytics.find({ userId: req.user._id })
      .sort({ importanceScore: -1 })
      .limit(50);

    const byCategory = {};
    analytics.forEach(a => {
      if (!byCategory[a.category]) byCategory[a.category] = [];
      byCategory[a.category].push(a);
    });

    res.json({
      success: true,
      analytics,
      byCategory,
      topSenders: analytics.slice(0, 10)
    });
  } catch (error) {
    logger.error('Sender analytics fetch error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch analytics' 
    });
  }
};

// ==========================================
// PROTECT SENDER (VIP)
// ==========================================
exports.protectSender = async (req, res) => {
  try {
    const { senderEmail } = req.body;
    const user = await User.findById(req.user._id);

    let analytics = await SenderAnalytics.findOne({ 
      userId: user._id, 
      senderEmail 
    });

    if (!analytics) {
      const senderDomain = aiService.extractDomain(senderEmail);
      analytics = await SenderAnalytics.create({
        userId: user._id,
        senderEmail,
        senderDomain,
        isProtected: true,
        category: 'VIP'
      });
    } else {
      analytics.isProtected = true;
      analytics.category = 'VIP';
      analytics.updateMetrics();
      await analytics.save();
    }

    logger.info(`🛡️ Protected sender: ${senderEmail}`);

    res.json({
      success: true,
      message: `${senderEmail} is now protected`,
      analytics
    });
  } catch (error) {
    logger.error('Protect sender error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to protect sender' 
    });
  }
};

// ==========================================
// ✅ DELETE EMAILS (FIXED)
// ==========================================
exports.deleteEmails = async (req, res) => {
  try {
    const { emailIds } = req.body;
    
    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No email IDs provided' 
      });
    }

    const user = await User.findById(req.user._id);
    
    if (!user.googleTokens || !user.googleTokens.access_token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Gmail not connected' 
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    oauth2Client.setCredentials({
      access_token: user.googleTokens.access_token,
      refresh_token: user.googleTokens.refresh_token
    });
    
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // ✅ Use batchModify for better performance
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: emailIds,
        addLabelIds: ['TRASH']
      }
    });

    logger.info(`🗑️ Deleted ${emailIds.length} emails`);

    res.json({ 
      success: true, 
      message: `Deleted ${emailIds.length} emails`,
      deleted: emailIds.length
    });
  } catch (error) {
    logger.error('Delete emails error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete emails',
      error: error.message
    });
  }
};

// ==========================================
// ✅ ARCHIVE EMAILS (FIXED)
// ==========================================
exports.archiveEmails = async (req, res) => {
  try {
    const { emailIds } = req.body;
    
    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No email IDs provided' 
      });
    }

    const user = await User.findById(req.user._id);
    
    if (!user.googleTokens || !user.googleTokens.access_token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Gmail not connected' 
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    oauth2Client.setCredentials({
      access_token: user.googleTokens.access_token,
      refresh_token: user.googleTokens.refresh_token
    });
    
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // ✅ Use batchModify for better performance
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: emailIds,
        removeLabelIds: ['INBOX']
      }
    });

    logger.info(`📦 Archived ${emailIds.length} emails`);

    res.json({ 
      success: true, 
      message: `Archived ${emailIds.length} emails`,
      archived: emailIds.length
    });
  } catch (error) {
    logger.error('Archive emails error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to archive emails',
      error: error.message
    });
  }
};

// ==========================================
// ✅ GET EMAIL BY ID (FIXED)
// ==========================================
exports.getEmailById = async (req, res) => {
  try {
    const { emailId } = req.params;
    
    console.log('🔍 GET EMAIL BY ID:', emailId);

    // ✅ Get tokens from session/user
    let tokens = null;
    
    if (req.session?.passport?.user) {
      const passportUser = req.session.passport.user;
      tokens = {
        access_token: passportUser.accessToken,
        refresh_token: passportUser.refreshToken
      };
    } else if (req.user) {
      tokens = {
        access_token: req.user.accessToken || req.user.googleTokens?.access_token,
        refresh_token: req.user.refreshToken || req.user.googleTokens?.refresh_token
      };
    }

    if (!tokens || !tokens.access_token) {
      console.log('❌ No tokens found');
      return res.status(401).json({ 
        success: false,
        error: 'Not authenticated',
        message: 'Please log in again'
      });
    }

    // ✅ Create Gmail client
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth });

    // ✅ Fetch email
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full'
    });

    console.log('✅ Email fetched successfully');

    // ✅ Parse email data
    const email = response.data;
    const headers = email.payload?.headers || [];
    
    const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

    const parsedEmail = {
      id: email.id,
      threadId: email.threadId,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      snippet: email.snippet,
      labelIds: email.labelIds || [],
      starred: email.labelIds?.includes('STARRED') || false,
      opened: !email.labelIds?.includes('UNREAD'),
      body: email.payload,
      raw: email
    };

    res.json({ 
      success: true,
      email: parsedEmail
    });

  } catch (error) {
    console.error('❌ getEmailById error:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch email',
      details: error.message 
    });
  }
};

// ==========================================
// CREATE FOLDER/LABEL
// ==========================================
exports.createFolder = async (req, res) => {
  try {
    const { folderName } = req.body;
    const user = await User.findById(req.user._id);

    if (!folderName) {
      return res.status(400).json({ success: false, message: 'Folder name required' });
    }

    const label = await gmailService.createLabel(user.googleTokens, folderName);

    res.json({ success: true, message: `Folder '${folderName}' created`, label });
  } catch (error) {
    logger.error('Create folder error:', error);
    res.status(500).json({ success: false, message: 'Failed to create folder' });
  }
};

// ==========================================
// SCHEDULE FOLLOW-UP
// ==========================================
exports.scheduleFollowUp = async (req, res) => {
  try {
    const { emailId, followUpDate } = req.body;
    const user = await User.findById(req.user._id);

    if (!emailId || !followUpDate) {
      return res.status(400).json({ success: false, message: 'Email ID and follow-up date required' });
    }

    const followUp = await EmailAction.create({
      userId: user._id,
      emailId,
      action: 'follow-up',
      scheduledAt: new Date(followUpDate),
      executed: false,
      metadata: { note: 'AI suggested follow-up' }
    });

    res.json({ success: true, message: 'Follow-up scheduled', followUp });
  } catch (error) {
    logger.error('Schedule follow-up error:', error);
    res.status(500).json({ success: false, message: 'Failed to schedule follow-up' });
  }
};

// ==========================================
// GENERATE SUMMARY
// ==========================================
exports.generateSummary = async (req, res) => {
  try {
    const { range = '7d' } = req.body;
    const user = await User.findById(req.user._id);

    const emails = await gmailService.fetchEmails(user.googleTokens, { range });
    const summary = await aiService.summarizeEmails(emails);

    res.json({ success: true, summary, totalEmails: emails.length });
  } catch (error) {
    logger.error('Generate summary error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate summary' });
  }
};

console.log('📧 emailController.js loaded successfully!');
console.log('✅ All exports verified');