// ✅ CORRECT: Use node-fetch for Node.js
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const generateEmail = async (req, res) => {
  try {
    const { prompt, tone = 'professional', context } = req.body;
    
    console.log('🤖 AI Email Generate Request:', { prompt, tone, context }); // ✅ Debug log
    
    if (!prompt) {
      return res.status(400).json({ 
        success: false, 
        error: 'Prompt is required' 
      });
    }

    // Check if GROQ_API_KEY exists
    if (!process.env.GROQ_API_KEY) {
      console.error('❌ GROQ_API_KEY not set in environment variables');
      return res.status(500).json({
        success: false,
        error: 'AI service not configured. Please contact administrator.'
      });
    }

    // System prompts based on tone
    const tonePrompts = {
      professional: 'You are a professional business email writer. Write clear, concise, and formal emails.',
      casual: 'You are a friendly email writer. Write warm, conversational emails while maintaining professionalism.',
      friendly: 'You are a warm and approachable email writer. Write friendly, personal emails.',
      brief: 'You are a concise email writer. Write short, to-the-point emails with minimal words.',
      detailed: 'You are a thorough email writer. Write comprehensive, detailed emails with all necessary information.'
    };

    const systemPrompt = tonePrompts[tone] || tonePrompts.professional;

    console.log('📡 Calling Groq API...'); // ✅ Debug log

    // Call Groq API
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mixtral-8x7b-32768',
        messages: [
          {
            role: 'system',
            content: systemPrompt + ' Always include a subject line at the start in format "Subject: [subject]"'
          },
          {
            role: 'user',
            content: context 
              ? `Context: ${context}\n\nRequest: ${prompt}`
              : prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 800,
        top_p: 1,
        stream: false
      })
    });

    const data = await response.json();
    
    console.log('✅ Groq API Response Status:', response.status); // ✅ Debug log

    if (!response.ok) {
      console.error('❌ Groq API Error:', data);
      throw new Error(data.error?.message || 'AI generation failed');
    }

    const generatedEmail = data.choices[0].message.content;

    // Parse subject and body
    const subjectMatch = generatedEmail.match(/Subject:\s*(.+?)(?:\n|$)/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : '';
    const body = generatedEmail.replace(/Subject:\s*.+?(?:\n|$)/i, '').trim();

    console.log('✅ Email generated successfully'); // ✅ Debug log

    res.json({
      success: true,
      email: {
        subject,
        body,
        full: generatedEmail
      }
    });

  } catch (error) {
    console.error('❌ AI Email Generation Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate email. Please try again.'
    });
  }
};

const improveEmail = async (req, res) => {
  try {
    const { email, instruction } = req.body;

    if (!email || !instruction) {
      return res.status(400).json({
        success: false,
        error: 'Email and instruction are required'
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'AI service not configured'
      });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mixtral-8x7b-32768',
        messages: [
          {
            role: 'system',
            content: 'You are an expert email editor. Improve emails based on user instructions.'
          },
          {
            role: 'user',
            content: `Original Email:\n${email}\n\nInstruction: ${instruction}\n\nProvide the improved version:`
          }
        ],
        temperature: 0.7,
        max_tokens: 800
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'AI improvement failed');
    }

    res.json({
      success: true,
      improvedEmail: data.choices[0].message.content
    });

  } catch (error) {
    console.error('❌ AI Email Improvement Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to improve email. Please try again.'
    });
  }
};

module.exports = {
  generateEmail,
  improveEmail
};