const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

console.log('📮 Loading email routes...');

// ==========================================
// ✅ MIDDLEWARE - PROTECT ROUTES
// ==========================================

const protect = (req, res, next) => {
  console.log('🔐 Protect middleware called');
  console.log('🔐 req.isAuthenticated:', req.isAuthenticated ? req.isAuthenticated() : 'function not available');
  console.log('🔐 req.user:', req.user);
  console.log('🔐 req.session:', req.session);
  
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    console.log('❌ Not authenticated via passport');
    return res.status(401).json({ 
      success: false, 
      error: 'Not authenticated' 
    });
  }
  
  if (!req.user || !req.user.tokens) {
    console.log('❌ No user or tokens found');
    return res.status(401).json({ 
      success: false, 
      error: 'Not authenticated - missing tokens' 
    });
  }
  
  console.log('✅ Authentication successful');
  next();
};

// ==========================================
// ✅ GET ALL INBOX EMAILS
// ==========================================

router.get('/emails', protect, async (req, res) => {
  try {
    console.log('📧 GET /api/email/emails called');
    
    if (!req.user || !req.user.tokens) {
      return res.status(401).json({ 
        success: false, 
        error: 'Not authenticated' 
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(req.user.tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    console.log('📧 Fetching emails from Gmail INBOX...');

    // Get INBOX emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 100
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      console.log('✅ No inbox emails found');
      return res.json({ 
        success: true, 
        emails: [], 
        total: 0 
      });
    }

    console.log(`📧 Found ${response.data.messages.length} inbox emails, fetching details...`);

    // Fetch email details in batches
    const batchSize = 10;
    const allEmails = [];

    for (let i = 0; i < response.data.messages.length; i += batchSize) {
      const batch = response.data.messages.slice(i, i + batchSize);
      
      const emailDetails = await Promise.all(
        batch.map(async (message) => {
          try {
            const detail = await gmail.users.messages.get({
              userId: 'me',
              id: message.id,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date']
            });

            const headers = detail.data.payload.headers;
            const from = headers.find(h => h.name === 'From')?.value || '';
            const subject = headers.find(h => h.name === 'Subject')?.value || '';
            const date = headers.find(h => h.name === 'Date')?.value || '';

            return {
              id: message.id,
              from,
              subject,
              date,
              snippet: detail.data.snippet || '',
              labelIds: detail.data.labelIds || []
            };
          } catch (error) {
            console.error(`❌ Error fetching email ${message.id}:`, error.message);
            return null;
          }
        })
      );

      allEmails.push(...emailDetails.filter(e => e !== null));
    }

    console.log(`✅ Successfully fetched ${allEmails.length} emails`);

    res.json({
      success: true,
      emails: allEmails,
      total: allEmails.length
    });

  } catch (error) {
    console.error('❌ Error fetching emails:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// ✅ ANALYZE EMAILS - RULE-BASED AI
// ==========================================

router.post('/analyze', protect, async (req, res) => {
  try {
    console.log('🤖 POST /api/email/analyze called (Rule-Based)');
    
    if (!req.user || !req.user.tokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { emails } = req.body;

    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ success: false, error: 'Invalid emails data' });
    }

    console.log(`🔍 Analyzing ${emails.length} emails using rule-based system...`);

    // Analyze each email
    const recommendations = emails.map(email => {
      const analysis = analyzeEmail(email);
      
      return {
        emailId: email.id,
        from: email.from,
        subject: email.subject,
        action: analysis.action,
        reason: analysis.reason,
        category: analysis.category,
        confidence: analysis.confidence,
        score: analysis.score,
        date: email.date
      };
    });


    // Calculate summary
    const summary = {
      total: recommendations.length,
      toArchive: recommendations.filter(r => r.action === 'archive').length,
      toDelete: recommendations.filter(r => r.action === 'delete').length,
      toKeep: recommendations.filter(r => r.action === 'keep').length,
      byCategory: {
        promotional: recommendations.filter(r => r.category === 'Promotional').length,
        social: recommendations.filter(r => r.category === 'Social Media').length,
        newsletter: recommendations.filter(r => r.category === 'Newsletter').length,
        receipts: recommendations.filter(r => r.category === 'Receipts').length,
        primary: recommendations.filter(r => r.category === 'Primary').length
      }
    };

    console.log('✅ Analysis complete:', summary);

    res.json({
      success: true,
      recommendations,
      summary,
      method: 'rule-based'
    });

  } catch (error) {
    console.error('❌ Error analyzing emails:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ✅ RULE-BASED EMAIL ANALYSIS FUNCTION
// ==========================================

function analyzeEmail(email) {
  let score = 0;
  let reasons = [];
  let category = 'Primary';
  
  const from = (email.from || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();
  const snippet = (email.snippet || '').toLowerCase();
  
  // 1. GMAIL'S BUILT-IN CATEGORIZATION (Most reliable!)
  if (email.labelIds?.includes('CATEGORY_PROMOTIONS')) {
    score += 70;
    category = 'Promotional';
    reasons.push('Gmail categorized as promotional');
  }
  
  if (email.labelIds?.includes('CATEGORY_SOCIAL')) {
    score += 60;
    category = 'Social Media';
    reasons.push('Social media notification');
  }
  
  if (email.labelIds?.includes('CATEGORY_UPDATES')) {
    score += 50;
    category = 'Newsletter';
    reasons.push('Newsletter/update email');
  }
  
  if (email.labelIds?.includes('CATEGORY_FORUMS')) {
    score += 45;
    category = 'Forums';
    reasons.push('Forum notification');
  }
  
  // 2. PROMOTIONAL KEYWORDS
  const promoKeywords = [
    'sale', 'discount', '% off', 'deal', 'offer', 'promo',
    'free shipping', 'limited time', 'shop now', 'buy now',
    'exclusive offer', 'save now', 'clearance', 'flash sale',
    'black friday', 'cyber monday', 'coupon', 'voucher'
  ];
  
  const promoMatches = promoKeywords.filter(kw => 
    subject.includes(kw) || snippet.includes(kw)
  );
  
  if (promoMatches.length >= 2) {
    score += 50;
    category = category === 'Primary' ? 'Promotional' : category;
    reasons.push(`${promoMatches.length} promotional keywords found`);
  } else if (promoMatches.length === 1) {
    score += 25;
  }
  
  // 3. UNSUBSCRIBE LINK (Newsletter indicator)
  if (snippet.includes('unsubscribe') || snippet.includes('opt out') || 
      snippet.includes('manage preferences')) {
    score += 35;
    reasons.push('Contains unsubscribe link (likely marketing)');
  }
  
  // 4. SOCIAL MEDIA PLATFORMS
  const socialDomains = [
    'facebook.com', 'facebookmail.com', 'twitter.com', 'x.com',
    'linkedin.com', 'instagram.com', 'tiktok.com', 'pinterest.com',
    'reddit.com', 'snapchat.com', 'youtube.com', 'quora.com'
  ];
  
  const socialPhrases = [
    'liked your', 'commented on', 'shared your', 'mentioned you',
    'tagged you', 'sent you a message', 'friend request', 'connection request',
    'new follower', 'started following'
  ];
  
  if (socialDomains.some(d => from.includes(d))) {
    score += 55;
    category = 'Social Media';
    reasons.push('Social media platform');
  }
  
  if (socialPhrases.some(p => subject.includes(p) || snippet.includes(p))) {
    score += 40;
    category = category === 'Primary' ? 'Social Media' : category;
    reasons.push('Social media activity notification');
  }
  
  // 5. NEWSLETTER/MARKETING SERVICES
  const newsletterDomains = [
    'substack.com', 'mailchimp', 'sendgrid', 'constantcontact',
    'campaignmonitor', 'aweber', 'getresponse', 'convertkit',
    'activecampaign', 'drip', 'klaviyo', 'sendinblue'
  ];
  
  const newsletterKeywords = [
    'newsletter', 'weekly digest', 'daily digest', 'roundup',
    'this week in', 'subscribe'
  ];
  
  if (newsletterDomains.some(d => from.includes(d))) {
    score += 45;
    category = category === 'Primary' ? 'Newsletter' : category;
    reasons.push('Sent via newsletter service');
  }
  
  if (newsletterKeywords.some(kw => subject.includes(kw))) {
    score += 30;
    reasons.push('Newsletter detected');
  }
  
  // 6. AUTOMATED NOTIFICATIONS
  const automatedPhrases = [
    'noreply@', 'no-reply@', 'donotreply@', 'automated',
    'notification', 'alert', 'reminder', 'confirmation'
  ];
  
  if (automatedPhrases.some(p => from.includes(p) || subject.includes(p))) {
    score += 20;
    reasons.push('Automated message');
  }
  
  // 7. AGE OF EMAIL
  try {
    const emailDate = new Date(email.date);
    const now = new Date();
    const daysOld = Math.floor((now - emailDate) / (1000 * 60 * 60 * 24));
    
    if (daysOld > 90) {
      score += 30;
      reasons.push(`Email is ${daysOld} days old`);
    } else if (daysOld > 60) {
      score += 20;
      reasons.push(`Email is ${daysOld} days old`);
    } else if (daysOld > 30) {
      score += 15;
      reasons.push(`Unopened for ${daysOld}+ days`);
    } else if (daysOld > 15) {
      score += 10;
    }
  } catch (error) {
    // Invalid date, skip age check
  }
  
  // 8. IMPORTANT EMAIL PROTECTION
  const importantKeywords = [
    'invoice', 'receipt', 'payment', 'bill', 'statement',
    'urgent', 'important', 'action required', 'verify',
    'security', 'password', 'account', 'confirm'
  ];
  
  const personalDomains = ['@gmail.com', '@yahoo.com', '@hotmail.com', '@outlook.com'];
  
  if (importantKeywords.some(kw => subject.includes(kw))) {
    score -= 40; // Reduce cleanup score
    reasons.push('Contains important keywords');
    category = 'Receipts';
  }
  
  if (personalDomains.some(d => from.includes(d)) && score < 50) {
    score -= 20; // Personal emails are more important
    reasons.push('Personal email address');
  }
  
  // 9. STARRED/IMPORTANT LABELS
  if (email.labelIds?.includes('STARRED')) {
    score = 0; // Never cleanup starred emails
    category = 'Primary';
    reasons = ['Email is starred'];
  }
  
  if (email.labelIds?.includes('IMPORTANT')) {
    score -= 50;
    reasons.push('Marked as important');
  }
  
  // 10. DECIDE ACTION BASED ON SCORE
  let action = 'keep';
  let confidence = 0;
  
  if (score >= 120) {
    action = 'delete';
    confidence = Math.min(95, score - 20);
  } else if (score >= 80) {
    action = 'archive';
    confidence = Math.min(90, score - 10);
  } else if (score >= 50) {
    action = 'archive';
    confidence = Math.min(75, score);
  } else {
    action = 'keep';
    confidence = Math.max(20, 100 - score);
  }
  
  // 11. FINAL SAFETY CHECKS
  // Never delete emails less than 7 days old
  try {
    const emailDate = new Date(email.date);
    const daysOld = Math.floor((Date.now() - emailDate) / (1000 * 60 * 60 * 24));
    
    if (daysOld < 7 && action === 'delete') {
      action = 'archive';
      reasons.push('Too recent to delete');
    }
  } catch (error) {
    // Skip check if date is invalid
  }
  
  return {
    action,
    category,
    reason: reasons.length > 0 ? reasons.join(' • ') : 'No cleanup needed',
    confidence: Math.min(100, Math.max(0, confidence)),
    score
  };
}

// ==========================================
// ✅ ARCHIVE EMAILS
// ==========================================

router.post('/archive', protect, async (req, res) => {
  try {
    console.log('📦 POST /api/email/archive called');
    
    if (!req.user || !req.user.tokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { emailIds } = req.body;

    if (!emailIds || !Array.isArray(emailIds)) {
      return res.status(400).json({ success: false, error: 'Invalid email IDs' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(req.user.tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Archive emails (remove INBOX label)
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: emailIds,
        removeLabelIds: ['INBOX']
      }
    });

    console.log(`✅ Archived ${emailIds.length} emails`);

    res.json({
      success: true,
      message: `Archived ${emailIds.length} email(s)`,
      count: emailIds.length
    });

  } catch (error) {
    console.error('❌ Error archiving emails:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// ==========================================
// ✅ DELETE EMAILS
// ==========================================
router.post('/delete', protect, async (req, res) => {
  try {
    console.log('🗑️ POST /api/email/delete called');

    if (!req.user || !req.user.tokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { emailIds } = req.body;

    if (!emailIds || !Array.isArray(emailIds)) {
      return res.status(400).json({ success: false, error: 'Invalid email IDs' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(req.user.tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Move to trash
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: emailIds,
        addLabelIds: ['TRASH']
      }
    });

    console.log(`✅ Deleted ${emailIds.length} emails`);

    res.json({
      success: true,
      message: `Deleted ${emailIds.length} email(s)`,
      count: emailIds.length
    });

  } catch (error) {
    console.error('❌ Error deleting emails:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ✅ FORWARD EMAIL
// ==========================================
router.post('/forward', protect, async (req, res) => {
  try {
    const { emailId, forwardTo } = req.body;
    if (!emailId || !forwardTo) 
      return res.status(400).json({ success: false, error: 'Missing emailId or forwardTo' });

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(req.user.tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch original email
    const emailDetail = await gmail.users.messages.get({ 
      userId: 'me', 
      id: emailId, 
      format: 'full' 
    });

    const subject = emailDetail.data.payload.headers.find(h => h.name === 'Subject')?.value || '';
    const snippet = emailDetail.data.snippet || '';

    // Compose new forward email
    const raw = [
      `To: ${forwardTo}`,
      `Subject: Fwd: ${subject}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      `--- Forwarded message ---\n${snippet}`
    ].join('\n');

    const encodedMessage = Buffer.from(raw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });

    res.json({ success: true, message: `Email forwarded to ${forwardTo}` });

  } catch (error) {
    console.error('❌ Error forwarding email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ==========================================
// ✅ GET SINGLE EMAIL FULL CONTENT
// ==========================================

router.get('/message/:emailId', protect, async (req, res) => {
  try {
    console.log(`📧 GET /api/email/message/${req.params.emailId}`);
    
    if (!req.user || !req.user.tokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { emailId } = req.params;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(req.user.tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    console.log('📧 Fetching full email from Gmail...');

    // ✅ Get full email with body
    const email = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full'
    });

    const headers = email.data.payload.headers;
    
    // ✅ Helper function to decode base64
    const decodeBase64 = (data) => {
      try {
        return Buffer.from(
          data.replace(/-/g, '+').replace(/_/g, '/'),
          'base64'
        ).toString('utf-8');
      } catch (e) {
        console.error('Error decoding base64:', e);
        return '';
      }
    };
    
    // ✅ Extract body from email
    let body = '';
    let isHtml = false;
    
    // Try to get body from main payload
    if (email.data.payload.body?.data) {
      body = decodeBase64(email.data.payload.body.data);
      isHtml = email.data.payload.mimeType === 'text/html';
    } 
    // Try to get from parts
    else if (email.data.payload.parts) {
      // First try to find HTML part
      let htmlPart = email.data.payload.parts.find(p => p.mimeType === 'text/html');
      let textPart = email.data.payload.parts.find(p => p.mimeType === 'text/plain');
      
      // Check nested parts (multipart/alternative)
      if (!htmlPart && !textPart) {
        for (const part of email.data.payload.parts) {
          if (part.parts) {
            htmlPart = htmlPart || part.parts.find(p => p.mimeType === 'text/html');
            textPart = textPart || part.parts.find(p => p.mimeType === 'text/plain');
          }
        }
      }
      
      // Prefer HTML, fallback to plain text
      if (htmlPart?.body?.data) {
        body = decodeBase64(htmlPart.body.data);
        isHtml = true;
      } else if (textPart?.body?.data) {
        body = decodeBase64(textPart.body.data);
        isHtml = false;
      }
    }

    // If still no body, use snippet
    if (!body || body.trim().length === 0) {
      body = email.data.snippet || 'No content available';
      isHtml = false;
    }

    // Convert plain text to HTML for display
    if (!isHtml && body) {
      body = body
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/  /g, '&nbsp;&nbsp;');
    }

    console.log(`✅ Loaded email content (${body.length} chars, ${isHtml ? 'HTML' : 'TEXT'})`);

    res.json({
      success: true,
      email: {
        id: email.data.id,
        from: headers.find(h => h.name === 'From')?.value,
        to: headers.find(h => h.name === 'To')?.value,
        subject: headers.find(h => h.name === 'Subject')?.value,
        date: headers.find(h => h.name === 'Date')?.value,
        body: body,
        snippet: email.data.snippet,
        labelIds: email.data.labelIds
      }
    });

  } catch (error) {
    console.error('❌ Error fetching email:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
// ==========================================
// ✅ RESTORE EMAIL FROM TRASH
// ==========================================
router.post('/:emailId/restore', protect, async (req, res) => {
  try {
    console.log(`♻️ POST /api/email/${req.params.emailId}/restore`);
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { emailId } = req.params;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token: req.user.googleTokens.access_token,
      refresh_token: req.user.googleTokens.refresh_token,
      expiry_date: req.user.googleTokens.expiry_date
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Restore from trash (untrash)
    await gmail.users.messages.untrash({
      userId: 'me',
      id: emailId
    });

    console.log(`✅ Email ${emailId} restored from trash`);

    res.json({
      success: true,
      message: 'Email restored from trash'
    });

  } catch (error) {
    console.error('❌ Error restoring email:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// ✅ EMPTY TRASH (DELETE ALL TRASH EMAILS)
// ==========================================
router.post('/trash/empty', protect, async (req, res) => {
  try {
    console.log('🗑️ POST /api/email/trash/empty');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token: req.user.googleTokens.access_token,
      refresh_token: req.user.googleTokens.refresh_token,
      expiry_date: req.user.googleTokens.expiry_date
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get all trash emails first
    const trashList = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['TRASH'],
      maxResults: 500  // Gmail API limit
    });

    if (!trashList.data.messages || trashList.data.messages.length === 0) {
      return res.json({
        success: true,
        message: 'Trash is already empty',
        count: 0
      });
    }

    const emailIds = trashList.data.messages.map(m => m.id);
    
    console.log(`🗑️ Deleting ${emailIds.length} emails from trash...`);

    // Delete all trash emails (batch delete)
    // Note: Gmail doesn't have a native "empty trash" endpoint
    // We need to delete each email individually or use batchDelete
    const deletePromises = emailIds.map(id =>
      gmail.users.messages.trash({  // Move to trash (already there) then...
        userId: 'me',
        id: id
      })
    );

    await Promise.all(deletePromises);

    console.log(`✅ Trash emptied: ${emailIds.length} emails deleted`);

    res.json({
      success: true,
      message: `Trash emptied: ${emailIds.length} emails deleted`,
      count: emailIds.length
    });

  } catch (error) {
    console.error('❌ Error emptying trash:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;