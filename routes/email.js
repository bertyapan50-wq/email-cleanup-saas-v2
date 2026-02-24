const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const emailActions = require('../controllers/emailActions');
const { protect } = require('../middleware/auth');
const { checkEmailQuota } = require('../middleware/subscription');
const { google } = require('googleapis');

console.log('📮 Loading email routes...');
console.log('emailController.analyzeEmailsSimple:', typeof emailController.analyzeEmailsSimple);

// ==========================================
// ✅ GMAIL FOLDER ROUTES - MUST BE FIRST!
// ==========================================

// ✅ GET EMAIL COUNTS FOR ALL FOLDERS
router.get('/gmail/counts', (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ 
      success: false, 
      error: 'Not authenticated' 
    });
  }
  next();
}, async (req, res) => {
  try {
    console.log('📊 GET /gmail/counts called');
    
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

    const [inbox, sent, drafts, starred, spam, trash] = await Promise.all([
      gmail.users.labels.get({ userId: 'me', id: 'INBOX' }),
      gmail.users.labels.get({ userId: 'me', id: 'SENT' }),
      gmail.users.labels.get({ userId: 'me', id: 'DRAFT' }),
      gmail.users.labels.get({ userId: 'me', id: 'STARRED' }),
      gmail.users.labels.get({ userId: 'me', id: 'SPAM' }),
      gmail.users.labels.get({ userId: 'me', id: 'TRASH' })
    ]);

    const profile = await gmail.users.getProfile({ userId: 'me' });
    const totalEmails = profile.data.messagesTotal || 0;
    const inboxCount = inbox.data.messagesTotal || 0;
    const archiveCount = Math.max(0, totalEmails - inboxCount);

    console.log('✅ Email counts retrieved successfully');
    
    res.json({
      success: true,
      counts: {
        inbox: inboxCount,
        archive: archiveCount,
        sent: sent.data.messagesTotal || 0,
        drafts: drafts.data.messagesTotal || 0,
        starred: starred.data.messagesTotal || 0,
        spam: spam.data.messagesTotal || 0,
        trash: trash.data.messagesTotal || 0
      }
    });

  } catch (error) {
    console.error('❌ Error getting email counts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ GET EMAILS FROM SPECIFIC FOLDER
router.get('/gmail/folder/:folderId', protect, async (req, res) => {
  try {
    console.log(`📧 GET /gmail/folder/${req.params.folderId} called`);
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { folderId } = req.params;
    const maxResults = parseInt(req.query.maxResults) || 50;

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

    const labelMap = {
      'inbox': ['INBOX'],
      'sent': ['SENT'],
      'drafts': ['DRAFT'],
      'starred': ['STARRED'],
      'spam': ['SPAM'],
      'trash': ['TRASH'],
      'archive': []
    };

    let labelIds = labelMap[folderId];
    
    if (!labelIds && folderId !== 'archive') {
      return res.status(400).json({ success: false, error: 'Invalid folder ID' });
    }

    let query = folderId === 'archive' ? '-in:inbox -in:trash -in:spam' : undefined;

    const response = await gmail.users.messages.list({
      userId: 'me',
      labelIds: labelIds.length > 0 ? labelIds : undefined,
      q: query,
      maxResults
    });

    const messages = response.data.messages || [];
    
    if (messages.length === 0) {
      console.log(`✅ No emails found in ${folderId}`);
      return res.json({
        success: true,
        folder: folderId,
        total: 0,
        emails: []
      });
    }

    const emailPromises = messages.map(msg =>
      gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
      })
    );

    const emailDetails = await Promise.all(emailPromises);

    const emails = emailDetails.map(detail => {
      const headers = detail.data.payload.headers;
      return {
        id: detail.data.id,
        threadId: detail.data.threadId,
        from: headers.find(h => h.name === 'From')?.value || 'Unknown',
        subject: headers.find(h => h.name === 'Subject')?.value || '(no subject)',
        date: headers.find(h => h.name === 'Date')?.value || new Date().toISOString(),
        snippet: detail.data.snippet,
        labelIds: detail.data.labelIds || [],
        category: folderId
      };
    });

    console.log(`✅ Loaded ${emails.length} emails from ${folderId}`);
    
    res.json({
      success: true,
      folder: folderId,
      total: emails.length,
      emails
    });

  } catch (error) {
    console.error(`❌ Error getting ${req.params.folderId} emails:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ MOVE EMAIL TO FOLDER
router.post('/gmail/move', protect, async (req, res) => {
  try {
    console.log('📦 POST /gmail/move called');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { emailIds, toFolder } = req.body;

    if (!emailIds || !Array.isArray(emailIds) || !toFolder) {
      return res.status(400).json({ success: false, error: 'Invalid request' });
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

    const labelOperations = {
      'archive': { removeLabelIds: ['INBOX'], addLabelIds: [] },
      'inbox': { removeLabelIds: [], addLabelIds: ['INBOX'] },
      'trash': { removeLabelIds: ['INBOX'], addLabelIds: ['TRASH'] },
      'spam': { removeLabelIds: ['INBOX'], addLabelIds: ['SPAM'] },
      'starred': { removeLabelIds: [], addLabelIds: ['STARRED'] }
    };

    const operation = labelOperations[toFolder];
    
    if (!operation) {
      return res.status(400).json({ success: false, error: 'Invalid target folder' });
    }

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: emailIds,
        removeLabelIds: operation.removeLabelIds,
        addLabelIds: operation.addLabelIds
      }
    });

    console.log(`✅ Moved ${emailIds.length} emails to ${toFolder}`);
    
    res.json({
      success: true,
      message: `Moved ${emailIds.length} email(s) to ${toFolder}`,
      count: emailIds.length
    });

  } catch (error) {
    console.error('❌ Error moving emails:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ✅ NEW: BASIC EMAIL ENDPOINTS FOR APP.JS
// ==========================================

// ✅ GET ALL INBOX EMAILS - Used by App.js loadRealEmails()
router.get('/emails', protect, async (req, res) => {
  try {
    console.log('📧 GET /api/email/emails called');
    
  
    
    if (!req.user || !req.user.googleTokens) {
      console.log('❌ No googleTokens found');
      return res.status(401).json({ 
        success: false, 
        error: 'Not authenticated - missing tokens' 
      });
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

    console.log('📧 Fetching all emails from Gmail INBOX...');

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

    // ✅ Fetch email details in batches
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
              category: getCategoryFromLabels(detail.data.labelIds),
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

// ✅ Helper: Get category from Gmail labels
function getCategoryFromLabels(labelIds) {
  if (!labelIds) return 'Primary';
  
  if (labelIds.includes('CATEGORY_PROMOTIONS')) return 'Promotions';
  if (labelIds.includes('CATEGORY_SOCIAL')) return 'Social';
  if (labelIds.includes('CATEGORY_UPDATES')) return 'Updates';
  if (labelIds.includes('CATEGORY_FORUMS')) return 'Forums';
  if (labelIds.includes('SPAM')) return 'Junk';
  
  return 'Primary';
}

// ==========================================
// ✅ ARCHIVE EMAILS - Used by Smart Cleanup
// ==========================================
router.post('/archive', protect, async (req, res) => {
  try {
    console.log('📦 POST /api/email/archive called');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { emailIds } = req.body;

    if (!emailIds || !Array.isArray(emailIds)) {
      return res.status(400).json({ success: false, error: 'Invalid email IDs' });
    }

    // ✅ Track cleanup usage for free/trial users (5+ emails = 1 cleanup)
    if (emailIds.length >= 5) {
      const User = require('../models/User');
      const user = await User.findById(req.user._id || req.user.id);
      
      try {
        await user.useCleanup();
        console.log(`✅ Cleanup used: ${user.freeCleanupCount} remaining`);
      } catch (error) {
        return res.status(403).json({
          success: false,
          message: error.message,
          needsUpgrade: true
        });
      }
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
// ✅ DELETE EMAILS - Used by Smart Cleanup
// ==========================================
router.post('/delete', protect, async (req, res) => {
  try {
    console.log('🗑️ POST /api/email/delete called');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { emailIds } = req.body;

    if (!emailIds || !Array.isArray(emailIds)) {
      return res.status(400).json({ success: false, error: 'Invalid email IDs' });
    }

    // ✅ Track cleanup usage for free/trial users (5+ emails = 1 cleanup)
    if (emailIds.length >= 5) {
      const User = require('../models/User');
      const user = await User.findById(req.user._id || req.user.id);
      
      try {
        await user.useCleanup();
        console.log(`✅ Cleanup used: ${user.freeCleanupCount} remaining`);
      } catch (error) {
        return res.status(403).json({
          success: false,
          message: error.message,
          needsUpgrade: true
        });
      }
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
// ✅ GET DRAFTS - Used by DraftsView.jsx
// ==========================================
router.get('/drafts', protect, async (req, res) => {
  try {
    console.log('📝 GET /api/email/drafts called');
    
    if (!req.user || !req.user.googleTokens) {
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
    oauth2Client.setCredentials({
      access_token: req.user.googleTokens.access_token,
      refresh_token: req.user.googleTokens.refresh_token,
      expiry_date: req.user.googleTokens.expiry_date
    });
// ==========================================
// ✅ DELETE DRAFT
// ==========================================
router.delete('/drafts/:draftId', protect, async (req, res) => {
  try {
    console.log(`🗑️ DELETE /api/email/drafts/${req.params.draftId}`);
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ 
        success: false, 
        error: 'Not authenticated' 
      });
    }

    const { draftId } = req.params;

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

    console.log('🗑️ Deleting draft from Gmail...');

    // Delete the draft
    await gmail.users.drafts.delete({
      userId: 'me',
      id: draftId
    });

    console.log(`✅ Draft ${draftId} deleted successfully`);

    res.json({
      success: true,
      message: 'Draft deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting draft:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    console.log('📝 Fetching drafts from Gmail...');

    // Get all drafts
    const response = await gmail.users.drafts.list({
      userId: 'me',
      maxResults: 100
    });

    if (!response.data.drafts || response.data.drafts.length === 0) {
      console.log('✅ No drafts found');
      return res.json({ 
        success: true, 
        drafts: [], 
        total: 0 
      });
    }

    console.log(`📝 Found ${response.data.drafts.length} drafts, fetching details...`);

    // Fetch draft details
    const draftDetails = await Promise.all(
      response.data.drafts.map(async (draft) => {
        try {
          const detail = await gmail.users.drafts.get({
            userId: 'me',
            id: draft.id,
            format: 'metadata',
            metadataHeaders: ['To', 'Subject', 'Date']
          });

          const headers = detail.data.message.payload.headers;
          const to = headers.find(h => h.name === 'To')?.value || '';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
          const date = headers.find(h => h.name === 'Date')?.value || new Date().toISOString();

          return {
            id: draft.id,
            messageId: detail.data.message.id,
            to,
            subject,
            date,
            snippet: detail.data.message.snippet || ''
          };
        } catch (error) {
          console.error(`❌ Error fetching draft ${draft.id}:`, error.message);
          return null;
        }
      })
    );

    const drafts = draftDetails.filter(d => d !== null);

    console.log(`✅ Successfully fetched ${drafts.length} drafts`);

    res.json({
      success: true,
      drafts,
      total: drafts.length
    });

  } catch (error) {
    console.error('❌ Error fetching drafts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// ✅ AI SUGGESTIONS - Analyze and recommend top emails
router.post('/suggestions/analyze', protect, async (req, res) => {
  try {
    console.log('💡 POST /api/email/suggestions/analyze called');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Get inbox emails
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

    console.log('📧 Fetching recent inbox emails for analysis...');

    // Fetch recent emails (last 50)
    const response = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 50
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      console.log('✅ No emails to analyze');
      return res.json({ success: true, suggestions: [] });
    }

    console.log(`📧 Found ${response.data.messages.length} emails, analyzing top 20...`);

    // Fetch email details (analyze only first 20 for performance)
    const emailDetails = await Promise.all(
      response.data.messages.slice(0, 20).map(async (message) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'full'
          });

          const headers = detail.data.payload.headers;
          const from = headers.find(h => h.name === 'From')?.value || '';
          const subject = headers.find(h => h.name === 'Subject')?.value || '';
          const date = headers.find(h => h.name === 'Date')?.value || '';
          
          // Get email body
          let body = '';
          if (detail.data.payload.body?.data) {
            body = Buffer.from(detail.data.payload.body.data, 'base64').toString();
          } else if (detail.data.payload.parts) {
            const textPart = detail.data.payload.parts.find(p => p.mimeType === 'text/plain');
            if (textPart?.body?.data) {
              body = Buffer.from(textPart.body.data, 'base64').toString();
            }
          }

          return {
            id: message.id,
            from,
            subject,
            date,
            snippet: detail.data.snippet,
            body: body.substring(0, 500), // First 500 chars only
            labelIds: detail.data.labelIds || []
          };
        } catch (error) {
          console.error(`❌ Error fetching email ${message.id}:`, error.message);
          return null;
        }
      })
    );

    const validEmails = emailDetails.filter(e => e !== null);

    console.log(`🧠 Analyzing ${validEmails.length} emails...`);

    // Score and prioritize emails
    const scoredEmails = validEmails.map(email => {
      const score = calculatePriorityScore(email);
      const recommendation = getRecommendation(email, score);
      
      return {
        ...email,
        priority: score.priority,
        score: score.total,
        action: recommendation.action,
        reason: recommendation.reason,
        urgency: score.urgency
      };
    });

    // Sort by score and get top 7
    const suggestions = scoredEmails
      .sort((a, b) => b.score - a.score)
      .slice(0, 7);

    console.log(`✅ Generated ${suggestions.length} suggestions`);

    res.json({
      success: true,
      suggestions,
      total: suggestions.length
    });

  } catch (error) {
    console.error('❌ Error generating suggestions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Helper: Calculate priority score
function calculatePriorityScore(email) {
  let score = 0;
  let urgency = 'low';
  
  const subject = (email.subject || '').toLowerCase();
  const body = (email.body || '').toLowerCase();
  const from = (email.from || '').toLowerCase();
  
  // VIP senders (bosses, managers, clients)
  const vipKeywords = ['ceo', 'manager', 'director', 'boss', 'president', 'client'];
  if (vipKeywords.some(k => from.includes(k))) {
    score += 30;
    urgency = 'high';
  }
  
  // Urgency keywords
  const urgentKeywords = ['urgent', 'asap', 'important', 'action required', 'deadline', 'due'];
  if (urgentKeywords.some(k => subject.includes(k) || body.includes(k))) {
    score += 25;
    urgency = 'high';
  }
  
  // Questions (needs response)
  if (subject.includes('?') || body.match(/\?/g)?.length > 1) {
    score += 15;
  }
  
  // Time-sensitive
  const timeKeywords = ['today', 'tomorrow', 'this week', 'eod', 'asap'];
  if (timeKeywords.some(k => subject.includes(k) || body.includes(k))) {
    score += 20;
    urgency = urgency === 'low' ? 'medium' : urgency;
  }
  
  // Direct mention of name (you, your)
  if (body.match(/\b(you|your)\b/gi)?.length > 3) {
    score += 10;
  }
  
  // Meeting/calendar related
  if (subject.includes('meeting') || subject.includes('call') || subject.includes('invite')) {
    score += 15;
  }
  
  // Promotional/spam (lower score)
  const spamKeywords = ['unsubscribe', 'marketing', 'promotion', 'discount', 'offer', 'deal'];
  if (spamKeywords.some(k => body.includes(k))) {
    score -= 20;
  }
  
  // Newsletter detection
  if (from.includes('newsletter') || from.includes('noreply') || from.includes('no-reply')) {
    score -= 15;
  }
  
  // Determine priority level
  let priority = 'low';
  if (score >= 50) priority = 'high';
  else if (score >= 30) priority = 'medium';
  
  return { total: Math.max(0, score), priority, urgency };
}

// ✅ Helper: Get action recommendation
function getRecommendation(email, score) {
  const { priority, urgency } = score;
  
  if (priority === 'high') {
    if (urgency === 'high') {
      return {
        action: 'Reply Today',
        reason: 'Time-sensitive and high priority'
      };
    }
    return {
      action: 'Respond within 24h',
      reason: 'Important email from key sender'
    };
  }
  
  if (priority === 'medium') {
    if (email.subject && email.subject.includes('?')) {
      return {
        action: 'Reply when possible',
        reason: 'Contains questions needing response'
      };
    }
    return {
      action: 'Review and decide',
      reason: 'Moderate priority, requires attention'
    };
  }
  
  // Low priority
  const from = (email.from || '').toLowerCase();
  if (from.includes('newsletter') || from.includes('noreply')) {
    return {
      action: 'Read later or Archive',
      reason: 'Newsletter content, not urgent'
    };
  }
  
  return {
    action: 'Archive',
    reason: 'Low priority, can be archived'
  };
}
// ==========================================
// ✅ ANALYZE EMAILS - RULE-BASED AI
// ==========================================

router.post('/analyze', async (req, res) => {
  try {
    console.log('🤖 POST /api/email/analyze called');
    console.log('📧 Received emails count:', req.body?.emails?.length);
    
    const { emails } = req.body;

    // Validate request
    if (!emails) {
      console.error('❌ No emails in request body');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing emails in request body' 
      });
    }

    if (!Array.isArray(emails)) {
      console.error('❌ Emails is not an array');
      return res.status(400).json({ 
        success: false, 
        error: 'Emails must be an array' 
      });
    }

    console.log(`🔍 Analyzing ${emails.length} emails...`);

    // Analyze each email
    const recommendations = emails.map(email => {
      let score = 0;
      let reasons = [];
      let category = 'Primary';
      
      const from = (email.from || '').toLowerCase();
      const subject = (email.subject || '').toLowerCase();
      const snippet = (email.snippet || '').toLowerCase();
      
      // 1. Gmail Categories
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
      
      // 2. Promo keywords
      const promoWords = ['sale', 'discount', 'offer', 'deal', 'promo', 'free shipping'];
      const promoCount = promoWords.filter(w => subject.includes(w) || snippet.includes(w)).length;
      
      if (promoCount >= 2) {
        score += 50;
        category = category === 'Primary' ? 'Promotional' : category;
        reasons.push(`${promoCount} promotional keywords found`);
      }
      
      // 3. Unsubscribe link
      if (snippet.includes('unsubscribe')) {
        score += 35;
        reasons.push('Marketing email detected');
      }
      
      // 4. Social media domains
      const socialDomains = ['facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com'];
      if (socialDomains.some(d => from.includes(d))) {
        score += 55;
        category = 'Social Media';
        reasons.push('Social media platform');
      }
      
      // 5. Newsletter services
      const newsletterServices = ['mailchimp', 'sendgrid', 'substack'];
      if (newsletterServices.some(s => from.includes(s))) {
        score += 45;
        category = 'Newsletter';
        reasons.push('Newsletter service detected');
      }
      
      // 6. Email age
      try {
        const emailDate = new Date(email.date);
        const daysOld = Math.floor((Date.now() - emailDate) / (1000 * 60 * 60 * 24));
        
        if (daysOld > 30) {
          score += 20;
          reasons.push(`Unopened for ${daysOld}+ days`);
        }
      } catch (e) {
        // Invalid date
      }
      
      // 7. Important protection
      const important = ['invoice', 'receipt', 'payment', 'urgent'];
      if (important.some(w => subject.includes(w))) {
        score -= 40;
        reasons.push('Contains important keywords');
        category = 'Receipts';
      }
      
      // 8. Starred emails
      if (email.labelIds?.includes('STARRED')) {
        score = 0;
        category = 'Primary';
        reasons = ['Email is starred'];
      }
      
      // 9. Decide action
      let action = 'keep';
      let confidence = 50;
      
      if (score >= 120) {
        action = 'delete';
        confidence = 95;
      } else if (score >= 80) {
        action = 'archive';
        confidence = 85;
      } else if (score >= 50) {
        action = 'archive';
        confidence = 70;
      } else {
        confidence = Math.max(20, 100 - score);
      }
      
      return {
        emailId: email.id,
        from: email.from,
        subject: email.subject,
        action: action,
        reason: reasons.join(' • ') || 'No cleanup needed',
        category: category,
        confidence: confidence,
        score: score,
        date: email.date
      };
    });

    const summary = {
      total: recommendations.length,
      toArchive: recommendations.filter(r => r.action === 'archive').length,
      toDelete: recommendations.filter(r => r.action === 'delete').length,
      toKeep: recommendations.filter(r => r.action === 'keep').length
    };

    console.log(`✅ Analysis complete:`, summary);

    res.json({
      success: true,
      recommendations,
      summary
    });

  } catch (error) {
    console.error('❌ Analyze endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// ✅ NEW: GROUPED AI SUGGESTIONS FOR AI INSIGHTS
// ==========================================

router.post('/analyze-grouped', async (req, res) => {
  try {
    console.log('🧠 POST /api/email/analyze-grouped called');
    
    const { emails } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.json({
        success: true,
        suggestions: [],
        statistics: {}
      });
    }

    console.log(`🔍 Analyzing ${emails.length} emails...`);

    // ✅ STEP 1: Analyze each email (reuse existing logic)
    const recommendations = emails.map(email => {
      let score = 0;
      let reasons = [];
      let category = 'Primary';
      
      const from = (email.from || '').toLowerCase();
      const subject = (email.subject || '').toLowerCase();
      const snippet = (email.snippet || '').toLowerCase();
      
      // Gmail Categories
      if (email.labelIds?.includes('CATEGORY_PROMOTIONS')) {
        score += 70;
        category = 'Promotional';
        reasons.push('PROMOTIONAL_CONTENT');
      }
      
      if (email.labelIds?.includes('CATEGORY_SOCIAL')) {
        score += 60;
        category = 'Social Media';
        reasons.push('SOCIAL_NOTIFICATION');
      }
      
      if (email.labelIds?.includes('CATEGORY_UPDATES')) {
        score += 50;
        category = 'Newsletter';
        reasons.push('NEWSLETTER_CONTENT');
      }
      
      // Promo keywords
      const promoWords = ['sale', 'discount', 'offer', 'deal', 'promo', 'free shipping'];
      const promoCount = promoWords.filter(w => subject.includes(w) || snippet.includes(w)).length;
      
      if (promoCount >= 2) {
        score += 50;
        category = category === 'Primary' ? 'Promotional' : category;
        reasons.push('PROMOTIONAL_KEYWORDS');
      }
      
      if (snippet.includes('unsubscribe')) {
        score += 35;
        reasons.push('MARKETING_EMAIL');
      }
      
      // Email age
      try {
        const emailDate = new Date(email.date);
        const daysOld = Math.floor((Date.now() - emailDate) / (1000 * 60 * 60 * 24));
        
        if (daysOld > 30) {
          score += 20;
          reasons.push('UNOPENED_30_DAYS');
        }
      } catch (e) {}
      
      // Important protection
      const important = ['invoice', 'receipt', 'payment', 'urgent'];
      if (important.some(w => subject.includes(w))) {
        score -= 40;
        reasons.push('IMPORTANT_KEYWORDS');
        category = 'Receipts';
      }
      
      // Starred protection
      if (email.labelIds?.includes('STARRED')) {
        score = 0;
        category = 'Primary';
        reasons = ['STARRED_EMAIL'];
      }
      
      // Decide action & confidence
      let action = 'KEEP';
      let confidence = 'LOW';
      
      if (score >= 120) {
        action = 'DELETE_ALL';
        confidence = 'VERY_HIGH';
      } else if (score >= 80) {
        action = 'ARCHIVE_ALL';
        confidence = 'HIGH';
      } else if (score >= 50) {
        action = 'ARCHIVE_ALL';
        confidence = 'MEDIUM';
      }
      
      return {
        emailId: email.id,
        from: email.from,
        subject: email.subject,
        date: email.date,
        action,
        reasons,
        category,
        confidence,
        score
      };
    });

    // ✅ STEP 2: GROUP BY SENDER DOMAIN
    const groups = {};
    
    recommendations.forEach(rec => {
      const emailMatch = rec.from.match(/<(.+?)>/) || rec.from.match(/([^\s]+@[^\s]+)/);
      const email = emailMatch ? (emailMatch[1] || emailMatch[0]) : rec.from;
      const domain = email.split('@')[1] || email;
      
      if (!groups[domain]) {
        groups[domain] = {
          domain,
          emails: [],
          category: rec.category,
          totalScore: 0
        };
      }
      
      groups[domain].emails.push(rec);
      groups[domain].totalScore += rec.score;
    });

    // ✅ STEP 3: CREATE SUGGESTIONS
    const suggestions = Object.values(groups)
      .filter(g => g.emails.length >= 3) // Only groups with 3+ emails
      .map(group => {
        const avgScore = group.totalScore / group.emails.length;
        
        // Determine confidence
        let confidence = 'LOW';
        if (avgScore >= 100) confidence = 'VERY_HIGH';
        else if (avgScore >= 70) confidence = 'HIGH';
        else if (avgScore >= 40) confidence = 'MEDIUM';
        
        // Get unique reasons
        const allReasons = group.emails.flatMap(e => e.reasons);
        const uniqueReasons = [...new Set(allReasons)].slice(0, 4);
        
        // Determine action
        const actions = group.emails.map(e => e.action);
        const mostCommonAction = actions.sort((a,b) =>
          actions.filter(v => v === a).length - actions.filter(v => v === b).length
        ).pop();
        
        return {
          title: `${group.emails.length} emails from ${group.domain}`,
          sender_or_category: group.domain,
          category: group.category,
          emails_count: group.emails.length,
          confidence: confidence,
          reasons: uniqueReasons,
          suggested_actions: [mostCommonAction],
          safety_check: {
            is_safe: !uniqueReasons.includes('IMPORTANT_KEYWORDS')
          },
          safety_note: uniqueReasons.includes('IMPORTANT_KEYWORDS') 
            ? 'Contains important keywords - review carefully'
            : 'No important keywords detected. Safe to process.',
          email_ids: group.emails.map(e => e.emailId),
          emails: group.emails.map(e => ({
            from: e.from,
            subject: e.subject,
            date: e.date,
            isUnopened: true
          }))
        };
      })
      .sort((a, b) => {
        const confOrder = { VERY_HIGH: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return confOrder[b.confidence] - confOrder[a.confidence];
      });

    const statistics = {
      totalEmails: emails.length,
      groupsFound: Object.keys(groups).length,
      suggestionsGenerated: suggestions.length,
      highConfidence: suggestions.filter(s => s.confidence === 'VERY_HIGH' || s.confidence === 'HIGH').length
    };

    console.log(`✅ Generated ${suggestions.length} grouped suggestions`);

    res.json({
      success: true,
      suggestions,
      statistics
    });

  } catch (error) {
    console.error('❌ Analyze-grouped error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      suggestions: []
    });
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
    oauth2Client.setCredentials({
      access_token: req.user.googleTokens.access_token,
      refresh_token: req.user.googleTokens.refresh_token,
      expiry_date: req.user.googleTokens.expiry_date
    });

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
// ✅ REPLY TO EMAIL
// ==========================================
router.post('/reply', protect, async (req, res) => {
  try {
    console.log('✉️ POST /api/email/reply called');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { emailId, message } = req.body;

    if (!emailId || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing emailId or message' 
      });
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

    console.log('📧 Fetching original email...');

    // Fetch original email
    const emailDetail = await gmail.users.messages.get({ 
      userId: 'me', 
      id: emailId, 
      format: 'full' 
    });

    const headers = emailDetail.data.payload.headers;
    const originalFrom = headers.find(h => h.name === 'From')?.value || '';
    const originalSubject = headers.find(h => h.name === 'Subject')?.value || '';
    const messageId = headers.find(h => h.name === 'Message-ID')?.value || '';
    
    // Extract email address from "Name <email@domain.com>" format
    const toEmail = originalFrom.match(/<(.+?)>/) 
      ? originalFrom.match(/<(.+?)>/)[1] 
      : originalFrom;

    // Get user's email
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const userEmail = profile.data.emailAddress;

    console.log('📨 Composing reply...');
    console.log('To:', toEmail);
    console.log('Subject:', `Re: ${originalSubject}`);

    // Compose reply email
    const subject = originalSubject.startsWith('Re:') 
      ? originalSubject 
      : `Re: ${originalSubject}`;

    const rawMessage = [
      `From: ${userEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      messageId ? `In-Reply-To: ${messageId}` : '',
      messageId ? `References: ${messageId}` : '',
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      message
    ].filter(Boolean).join('\n');

    // Encode message to base64url
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    console.log('📤 Sending reply...');

    // Send reply
    await gmail.users.messages.send({ 
      userId: 'me', 
      requestBody: { 
        raw: encodedMessage,
        threadId: emailDetail.data.threadId // Keep it in the same thread
      } 
    });

    console.log('✅ Reply sent successfully');

    res.json({ 
      success: true, 
      message: 'Reply sent successfully' 
    });

  } catch (error) {
    console.error('❌ Error sending reply:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
// ==========================================
// ✅ SEND NEW EMAIL - AI Email Composer
// ==========================================
router.post('/send', protect, async (req, res) => {
  try {
    console.log('📤 POST /api/email/send called');

    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { to, subject, body } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ success: false, error: 'Missing to, subject, or body' });
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

    const profile = await gmail.users.getProfile({ userId: 'me' });
    const userEmail = profile.data.emailAddress;

    const rawMessage = [
      `From: ${userEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      body
    ].join('\n');

    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });

    console.log(`✅ Email sent to ${to}`);
    res.json({ success: true, message: `Email sent to ${to}` });

  } catch (error) {
    console.error('❌ Error sending email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// ==========================================
// ✅ GET SINGLE EMAIL FULL CONTENT - FOR INBOXVIEW
// ==========================================
router.get('/:emailId', protect, async (req, res) => {
  try {
    console.log(`📧 GET /api/email/message/${req.params.emailId}`);
    
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
// ✅ GET SINGLE EMAIL - FOR INBOXVIEW
// ==========================================
router.get('/message/:emailId', protect, async (req, res) => {
  try {
    console.log(`📧 GET /api/email/message/${req.params.emailId}`);
    
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

    console.log('📧 Fetching full email from Gmail...');

    // Get full email with body
    const email = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full'
    });

    const headers = email.data.payload.headers;
    
    // Helper function to decode base64
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
    
    // Extract body from email
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
// ✅ MARK EMAIL AS NOT SPAM
// ==========================================
router.post('/:emailId/not-spam', protect, async (req, res) => {
  try {
    console.log(`✅ POST /api/email/${req.params.emailId}/not-spam`);
    
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

    // Remove SPAM label and add to INBOX
    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: {
        removeLabelIds: ['SPAM'],
        addLabelIds: ['INBOX']
      }
    });

    console.log(`✅ Email ${emailId} marked as not spam`);

    res.json({
      success: true,
      message: 'Email marked as not spam and moved to inbox'
    });

  } catch (error) {
    console.error('❌ Error marking as not spam:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// ✅ DELETE EMAIL PERMANENTLY (MOVE TO TRASH)
// ==========================================
router.delete('/:emailId', protect, async (req, res) => {
  try {
    console.log(`🗑️ DELETE /api/email/${req.params.emailId}`);
    
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

    // ✅ CHANGE: Use trash() instead of delete()
    await gmail.users.messages.trash({  // ← Changed from .delete()
      userId: 'me',
      id: emailId
    });

    console.log(`✅ Email ${emailId} moved to trash`);

    res.json({
      success: true,
      message: 'Email moved to trash'  // ← Updated message
    });

  } catch (error) {
    console.error('❌ Error trashing email:', error);
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
// ✅ EMPTY TRASH
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

    const trashList = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['TRASH'],
      maxResults: 500
    });

    if (!trashList.data.messages || trashList.data.messages.length === 0) {
      return res.json({
        success: true,
        message: 'Trash is already empty',
        count: 0
      });
    }

    const emailIds = trashList.data.messages.map(m => m.id);
    
    console.log(`🗑️ Marking ${emailIds.length} emails for deletion...`);

    for (const id of emailIds) {
      await gmail.users.messages.trash({ userId: 'me', id });
    }

    res.json({
      success: true,
      message: `Marked ${emailIds.length} emails for permanent deletion`,
      count: emailIds.length
    });

  } catch (error) {
    console.error('❌ Error emptying trash:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});



module.exports = router;