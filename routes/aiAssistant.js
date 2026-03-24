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

  // Delete intents
  if (msg.includes('delete') && (msg.includes('promo') || msg.includes('promotion'))) return 'DELETE_PROMOTIONS';
  if (msg.includes('delete') && msg.includes('newsletter')) return 'DELETE_NEWSLETTERS';
  if (msg.includes('delete') && (msg.includes('spam') || msg.includes('junk'))) return 'DELETE_SPAM';
  if (msg.includes('delete') && msg.includes('all')) return 'DELETE_ALL';

  // Archive intents
  if ((msg.includes('archive') || msg.includes('clean')) && (msg.includes('newsletter') || msg.includes('news'))) return 'ARCHIVE_NEWSLETTERS';
  if ((msg.includes('archive') || msg.includes('clean')) && (msg.includes('promo') || msg.includes('promotion'))) return 'ARCHIVE_PROMOTIONS';
  if ((msg.includes('archive') || msg.includes('clean')) && msg.includes('social')) return 'ARCHIVE_SOCIAL';
  if ((msg.includes('archive') || msg.includes('clean')) && msg.includes('update')) return 'ARCHIVE_UPDATES';

  // General cleanup
  if (msg.includes('clean') || msg.includes('cleanup') || msg.includes('clean up') || msg.includes('declutter')) return 'CLEANUP';

  // Info intents
  if (msg.includes('summarize') || msg.includes('summary') || msg.includes('overview') || msg.includes('what') && msg.includes('inbox')) return 'SUMMARIZE';
  if (msg.includes('unread')) return 'UNREAD';
  if (msg.includes('who email') || msg.includes('top sender') || msg.includes('most email') || msg.includes('who sends')) return 'TOP_SENDERS';
  if (msg.includes('how many') || msg.includes('count') || msg.includes('total')) return 'COUNT';
  if (msg.includes('old') || msg.includes('oldest')) return 'OLD_EMAILS';
  if (msg.includes('help') || msg.includes('what can')) return 'HELP';

  return 'GENERAL';
};

// =====================
// POST /api/ai-assistant/chat
// =====================
router.post('/chat', protect, async (req, res) => {
  try {
    const { message, emailContext, conversationHistory = [], writingStyle = 'Professional' } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const user = await User.findById(req.user._id || req.user.id)
      || await User.findOne({ email: req.user.email });

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const intent = detectIntent(message);
    const ctx = emailContext || {};
    const topSenders = ctx.topSenders || [];

    // ✅ FIX: Show more recent emails for better AI context (up to 50)
    const recentEmailLines = (ctx.recentEmails || [])
      .slice(0, 50)
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

Recent emails (up to 50, for analysis):
${recentEmailLines || 'No recent emails available.'}
    `.trim();

    // ✅ FIX: System prompt now uses LOWERCASE action types to match frontend
    const styleGuide = {
  Professional: 'Use formal, clear, and structured language.',
  Friendly: 'Use warm, approachable, and encouraging language.',
  Concise: 'Use short, direct responses. Bullet points preferred. No fluff.',
  Casual: 'Use relaxed, conversational language with occasional emojis.'
};

const systemPrompt = `You are Zentrox AI, a smart email assistant for the Zentrox app. You help users manage and clean their Gmail inbox.
Writing style instruction: ${styleGuide[writingStyle] || styleGuide.Professional}

${emailSummary}

IMPORTANT RULES:
- Always answer based on the real inbox data shown above. Do NOT make up numbers.
- If the user asks "who emails me the most?", use the top senders list above.
- If the user asks "how many emails do I have?", use the exact total from above.
- If the user asks to summarize, describe the inbox categories with real counts.
- Be accurate, friendly, and concise. Use emojis occasionally.
- Address the user by first name: ${user.name?.split(' ')[0] || 'there'}.

WHEN THE USER WANTS TO TAKE ACTION (archive/delete/cleanup):
Include a JSON action block at the END of your response in this EXACT format.
IMPORTANT: Use LOWERCASE for "type" and "category" values.

<action>
{
  "type": "archive" | "delete" | "none",
  "category": "Promotions" | "Newsletters" | "Social" | "Updates" | "all",
  "count": <number from inbox context above>,
  "message": "<brief description of what will happen, e.g. Archive 42 promotional emails>"
}
</action>

Only include <action> block when the user is requesting a cleanup/delete/archive action.
Do NOT include <action> for questions, summaries, or general conversation.`;

    // ✅ FIX: Limit history to last 10 messages to avoid token overflow
    const history = conversationHistory.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const aiResponse = await callGroq(
      [...history, { role: 'user', content: message }],
      systemPrompt
    );

    // ✅ FIX: Parse action block and normalize type to lowercase
    let action = null;
    let cleanResponse = aiResponse;

    const actionMatch = aiResponse.match(/<action>([\s\S]*?)<\/action>/);
    if (actionMatch) {
      try {
        const parsed = JSON.parse(actionMatch[1].trim());

        // ✅ Normalize type to lowercase so frontend ActionCard works correctly
        action = {
          ...parsed,
          type: parsed.type?.toLowerCase() || 'none',
          category: parsed.category || 'all',
          count: parsed.count || 0,
          message: parsed.message || parsed.confirmMessage || `${parsed.type} emails`
        };

        // Don't send action if type is "none"
        if (action.type === 'none') action = null;

        cleanResponse = aiResponse.replace(/<action>[\s\S]*?<\/action>/, '').trim();
      } catch (e) {
        logger.error('Failed to parse AI action:', e.message);
        cleanResponse = aiResponse.replace(/<action>[\s\S]*?<\/action>/, '').trim();
      }
    }

    logger.info(`✅ AI Assistant response for ${user.email} | intent: ${intent} | action: ${action?.type || 'none'}`);

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