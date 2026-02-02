const EmailAction = require('../models/EmailAction');
const User = require('../models/User');
const gmailService = require('../services/gmailService');
const aiService = require('../services/aiService');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../utils/logger');

exports.fetchAndAnalyzeEmails = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.refreshToken) return res.status(400).json({ success: false, message: 'Gmail not connected. Please authorize Gmail access.' });

    const emails = await gmailService.fetchEmails(user.refreshToken);
    const analyses = await aiService.batchAnalyzeEmails(emails);

    const suggestions = await Promise.all(
      emails.map(async (email, index) => {
        const analysis = analyses[index];
        return await EmailAction.create({
          userId: user._id,
          emailId: email.id,
          action: analysis.action,
          metadata: { sender: email.sender, subject: email.subject, date: email.date, labels: email.labels, importance: analysis.importance },
          aiSuggestion: { action: analysis.action, confidence: analysis.confidence, reasoning: analysis.reasoning }
        });
      })
    );

    res.json({
      success: true,
      analyzed: emails.length,
      suggestions: suggestions.map(s => ({ id: s._id, emailId: s.emailId, action: s.action, metadata: s.metadata, aiSuggestion: s.aiSuggestion }))
    });
  } catch (error) {
    logger.error('Email analysis error:', error);
    res.status(500).json({ success: false, message: 'Failed to analyze emails' });
  }
};

exports.executeCleanup = async (req, res) => {
  try {
    const { actionIds } = req.body;
    const user = await User.findById(req.user._id);
    const actions = await EmailAction.find({ _id: { $in: actionIds }, userId: user._id, executed: false });

    let executed = 0;
    for (const action of actions) {
      try {
        await gmailService.executeAction(user.refreshToken, action.emailId, action.action);
        action.executed = true;
        action.executedAt = new Date();
        action.userApproved = true;
        await action.save();
        executed++;
      } catch (error) {
        logger.error(`Failed to execute action ${action._id}:`, error);
      }
    }

    user.emailQuotaUsed += executed;
    await user.save();

    await emailNotificationService.sendCleanupSummary(user.email, {
      analyzed: actions.length,
      cleaned: executed,
      spaceSaved: `${executed * 0.1} MB`
    });

    res.json({
      success: true,
      executed,
      failed: actions.length - executed,
      quotaRemaining: user.subscriptionTier === 'free' ? user.emailQuotaLimit - user.emailQuotaUsed : 'unlimited'
    });
  } catch (error) {
    logger.error('Cleanup execution error:', error);
    res.status(500).json({ success: false, message: 'Cleanup failed' });
  }
};

exports.getCleanupHistory = async (req, res) => {
  try {
    const history = await EmailAction.find({ userId: req.user._id, executed: true }).sort({ executedAt: -1 }).limit(100);
    res.json({ success: true, history });
  } catch (error) {
    logger.error('History fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch history' });
  }
};