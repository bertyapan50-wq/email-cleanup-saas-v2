const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const logger = require('../utils/logger');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// =====================
// Helper: Call Groq API
// =====================
const callGroq = async (messages, systemPrompt) => {
  const response = await axios.post(
    `${GROQ_BASE_URL}/chat/completions`,
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 1024,
    },
    {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      }
    }
  );
  return response.data.choices[0].message.content;
};

// =====================
// Helper: Detect intent from user message
// =====================
const detectIntent = (message) => {
  const msg = message.toLowerCase();
  if (msg.includes('delete') && (msg.includes('promo') || msg.includes('promotion'))) return 'DELETE_PROMOTIONS';
  if (msg.includes('archive') && (msg.includes('newsletter') || msg.includes('news'))) return 'ARCHIVE_NEWSLETTERS';
  if (msg.includes('archive') && (msg.includes('promo') || msg.includes('promotion'))) return 'ARCHIVE_PROMOTIONS';
  if (msg.includes('clean') || msg.includes('cleanup') || msg.includes('clean up')) return 'CLEANUP';
  if (msg.includes('summarize') || msg.includes('summary') || msg.includes('overview')) return 'SUMMARIZE';
  if (msg.includes('unread')) return 'UNREAD';
  if (msg.includes('who email') || msg.includes('top sender') || msg.includes('most email')) return 'TOP_SENDERS';
  if (msg.includes('how many') || msg.includes('count') || msg.includes('total')) return 'COUNT';
  if (msg.includes('old') || msg.includes('oldest')) return 'OLD_EMAILS';
  return 'GENERAL';
};

// =====================
// POST /api/ai-assistant/chat
// =====================
router.post('/chat', protect, async (req, res) => {
  try {
    const { message, emailContext, conversationHistory = [] } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const user = await User.findById(req.user._id || req.user.id)
      || await User.findOne({ email: req.user.email });

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const intent = detectIntent(message);
    const ctx = emailContext || {};
    const topSenders = ctx.topSenders || [];

    const recentEmailLines = (ctx.recentEmails || [])
      .slice(0, 20)
      .map(e => `  - [${e.category}] From: ${e.from} | Subject: "${e.subject}" | ${e.daysOld}d old | ${e.opened ? 'read' : 'UNREAD'}`)
      .join('\n');

    const emailSummary = `
User's inbox context:
- Total emails: ${ctx.total || 0}
- Unread: ${ctx.unread || 0}
- Promotions: ${ctx.promotions || 0}
- Newsletters: ${ctx.newsletters || 0}
- Social: ${ctx.social || 0}
- Updates: ${ctx.updates || 0}
- Spam/Junk: ${ctx.spam || 0}
- Top senders: ${topSenders.slice(0, 5).map(s => `${s.name} (${s.count} emails)`).join(', ') || 'N/A'}
- Subscription: ${user.subscriptionTier || 'free'}

Recent emails (for analysis):
${recentEmailLines || 'No recent emails available.'}
    `.trim();

    const systemPrompt = `You are InboxDetox AI, a smart email assistant for the InboxDetox app. You help users manage and clean their Gmail inbox.

${emailSummary}

You can answer questions about the inbox, suggest cleanup actions, and provide email management tips.

When you detect a cleanup/action request, include a JSON action block at the END of your response in this EXACT format (no extra text after it):
<action>
{
  "type": "ARCHIVE" | "DELETE" | "NONE",
  "category": "Promotions" | "Newsletters" | "Social" | "Updates" | "all",
  "count": number,
  "confirmMessage": "brief description of what will happen"
}
</action>

Keep responses concise, friendly, and helpful. Use emojis occasionally. Address the user by first name: ${user.name?.split(' ')[0] || 'there'}.`;

    const history = conversationHistory.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const aiResponse = await callGroq(
      [...history, { role: 'user', content: message }],
      systemPrompt
    );

    // Parse action block if present
    let action = null;
    let cleanResponse = aiResponse;

    const actionMatch = aiResponse.match(/<action>([\s\S]*?)<\/action>/);
    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1].trim());
        cleanResponse = aiResponse.replace(/<action>[\s\S]*?<\/action>/, '').trim();
      } catch (e) {
        logger.error('Failed to parse AI action:', e.message);
      }
    }

    logger.info(`✅ AI Assistant response for ${user.email} | intent: ${intent}`);

    res.json({
      success: true,
      message: cleanResponse,
      action,
      intent,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ AI Assistant error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'AI Assistant failed',
      message: "Sorry, I'm having trouble right now. Please try again in a moment. 🙏"
    });
  }
});

module.exports = router;