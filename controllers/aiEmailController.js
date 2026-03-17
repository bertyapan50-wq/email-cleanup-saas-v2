const gmailService = require('../services/gmailService');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────
// Helper: Call Groq API
// ─────────────────────────────────────────────
const callGroq = async (systemPrompt, userPrompt) => {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 800
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Groq API error');
  return data.choices[0].message.content;
};

// ─────────────────────────────────────────────
// Generate email from prompt
// ─────────────────────────────────────────────
const generateEmail = async (req, res) => {
  try {
    console.log('🤖 [AI EMAIL] Generate endpoint called');

    const { prompt, tone = 'professional', context } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ success: false, error: 'AI service not configured' });
    }

    const tonePrompts = {
      professional: 'You are a professional business email writer. Write clear, concise, and formal emails.',
      casual: 'You are a friendly email writer. Write warm, conversational emails while maintaining professionalism.',
      friendly: 'You are a warm and approachable email writer. Write friendly, personal emails.',
      brief: 'You are a concise email writer. Write short, to-the-point emails with minimal words.',
      detailed: 'You are a thorough email writer. Write comprehensive, detailed emails with all necessary information.'
    };

    const systemPrompt = (tonePrompts[tone] || tonePrompts.professional) +
      ' Always start emails with "Subject: [subject line]" followed by the email body.';

    const generatedEmail = await callGroq(
      systemPrompt,
      context ? `Context: ${context}\n\nRequest: ${prompt}` : prompt
    );

    const subjectMatch = generatedEmail.match(/Subject:\s*(.+?)(?:\n|$)/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : 'No Subject';
    const body = generatedEmail.replace(/Subject:\s*.+?(?:\n|$)/i, '').trim();

    console.log('✅ Email generated successfully');
    res.json({ success: true, email: { subject, body, full: generatedEmail } });

  } catch (error) {
    console.error('❌ Generate email error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate email' });
  }
};

// ─────────────────────────────────────────────
// Improve existing email
// ─────────────────────────────────────────────
const improveEmail = async (req, res) => {
  try {
    const { email, instruction } = req.body;

    if (!email || !instruction) {
      return res.status(400).json({ success: false, error: 'Email and instruction are required' });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ success: false, error: 'AI service not configured' });
    }

    const improvedEmail = await callGroq(
      'You are an expert email editor. Improve emails based on user instructions.',
      `Original Email:\n${email}\n\nInstruction: ${instruction}\n\nProvide the improved version:`
    );

    res.json({ success: true, improvedEmail });

  } catch (error) {
    console.error('❌ Improve email error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to improve email' });
  }
};

// ─────────────────────────────────────────────
// ✅ Smart Broadcast — Send personalized bulk emails
// ─────────────────────────────────────────────
const broadcastEmails = async (req, res) => {
  try {
    console.log('📤 [BROADCAST] Smart broadcast endpoint called');

    const {
      recipients,
      basePrompt,
      tone = 'professional',
      subject: manualSubject
    } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Recipients list is required' });
    }
    if (!basePrompt) {
      return res.status(400).json({ success: false, error: 'Base prompt/message is required' });
    }
    if (recipients.length > 100) {
  return res.status(400).json({ error: 'Maximum 100 recipients per broadcast' });
}
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ success: false, error: 'AI service not configured' });
    }
    if (!req.user?.googleTokens?.refresh_token) {
      return res.status(401).json({ success: false, error: 'Gmail not connected' });
    }

    const toneGuides = {
      professional: 'professional, formal, and respectful',
      friendly: 'warm, friendly, and approachable',
      casual: 'casual and conversational yet appropriate',
      brief: 'very concise and to the point',
      detailed: 'thorough and comprehensive'
    };

    const toneGuide = toneGuides[tone] || toneGuides.professional;

    console.log(`🧠 Personalizing emails for ${recipients.length} recipients...`);

    const personalizedEmails = [];

    for (const recipient of recipients) {
      const { email, name, context: recipientContext } = recipient;
      const recipientName = name || email.split('@')[0];

      const systemPrompt = `You are an expert email writer. Write a ${toneGuide} email that feels genuinely personal to the recipient.
Always output in this exact format:
Subject: [subject here]
[blank line]
[email body here]

Rules:
- Address the recipient by name naturally
- Keep it authentic, not template-like
- Do not include placeholders like [Name] in the final output
- Output ONLY the Subject line and email body. Nothing else.
- Do NOT add any notes, explanations, or meta-commentary after the email.
- End the email naturally with a sign-off. Do not add anything after it.
- Never use placeholders like [platform], [industry], or [field]. Use actual specific details from the context provided, or write naturally without them.
- For the sign-off, use "${req.user.name}" as the sender name.`;

      const userPrompt = `Write a personalized email to ${recipientName} (${email}).
${recipientContext ? `About this person: ${recipientContext}` : ''}

Base message/purpose: ${basePrompt}

Make it feel personal and genuine to ${recipientName}.`;

      try {
        const generated = await callGroq(systemPrompt, userPrompt);
        const subjectMatch = generated.match(/Subject:\s*(.+?)(?:\n|$)/i);
        const emailSubject = manualSubject || (subjectMatch ? subjectMatch[1].trim() : 'Hello');
        const emailBody = generated.replace(/Subject:\s*.+?(?:\n|$)/i, '').trim();

        personalizedEmails.push({ to: email, subject: emailSubject, body: emailBody, recipientName });
        console.log(`✅ Personalized for ${email}`);
      } catch (aiError) {
        console.error(`❌ AI failed for ${email}:`, aiError.message);
        personalizedEmails.push({ to: email, subject: null, body: null, error: aiError.message, recipientName });
      }
    }

    const readyToSend = personalizedEmails.filter(e => e.subject && e.body);
    const aiFailures = personalizedEmails.filter(e => !e.subject || !e.body);

    if (readyToSend.length === 0) {
      return res.status(500).json({ success: false, error: 'AI failed to generate any emails. Please try again.' });
    }

    console.log(`📨 Sending ${readyToSend.length} emails via Gmail...`);

    const broadcastResult = await gmailService.sendBroadcast(req.user.googleTokens.refresh_token, readyToSend);

    const response = {
      success: true,
      summary: {
        total: recipients.length,
        aiPersonalized: readyToSend.length,
        sent: broadcastResult.sent,
        failed: broadcastResult.failed + aiFailures.length,
        aiFailed: aiFailures.length
      },
      results: [
        ...broadcastResult.results,
        ...aiFailures.map(f => ({ success: false, to: f.to, error: `AI personalization failed: ${f.error}` }))
      ]
    };

    console.log(`✅ [BROADCAST] Done: ${broadcastResult.sent} sent, ${response.summary.failed} failed`);
    res.json(response);

  } catch (error) {
    console.error('❌ Broadcast error:', error);
    res.status(500).json({ success: false, error: error.message || 'Broadcast failed' });
  }
};

// ─────────────────────────────────────────────
// ✅ Preview personalized emails (no sending)
// ─────────────────────────────────────────────
const previewBroadcast = async (req, res) => {
  try {
    const { recipients, basePrompt, tone = 'professional' } = req.body;

    if (!recipients?.length || !basePrompt) {
      return res.status(400).json({ success: false, error: 'Recipients and prompt are required' });
    }

    const previewRecipients = recipients.slice(0, 3);

    const toneGuides = {
      professional: 'professional, formal, and respectful',
      friendly: 'warm, friendly, and approachable',
      casual: 'casual and conversational yet appropriate',
      brief: 'very concise and to the point',
      detailed: 'thorough and comprehensive'
    };

    const toneGuide = toneGuides[tone] || toneGuides.professional;
    const previews = [];

    for (const recipient of previewRecipients) {
      const { email, name, context: recipientContext } = recipient;
      const recipientName = name || email.split('@')[0];

      const systemPrompt = `You are an expert email writer. Write a ${toneGuide} email.
Always output in this exact format:
Subject: [subject here]
[blank line]
[email body here]`;

      const userPrompt = `Write a personalized email to ${recipientName} (${email}).
${recipientContext ? `About this person: ${recipientContext}` : ''}
Base message/purpose: ${basePrompt}`;

      try {
        const generated = await callGroq(systemPrompt, userPrompt);
        const subjectMatch = generated.match(/Subject:\s*(.+?)(?:\n|$)/i);
        const subject = subjectMatch ? subjectMatch[1].trim() : 'Hello';
        const body = generated.replace(/Subject:\s*.+?(?:\n|$)/i, '').trim();
        previews.push({ email, name: recipientName, subject, body, success: true });
      } catch (err) {
        previews.push({ email, name: recipientName, success: false, error: err.message });
      }
    }

    res.json({ success: true, previews, totalRecipients: recipients.length });

  } catch (error) {
    console.error('❌ Preview error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { generateEmail, improveEmail, broadcastEmails, previewBroadcast };