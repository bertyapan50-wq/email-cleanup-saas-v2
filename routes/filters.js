const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

console.log('🔧 Loading filters routes...');

// ==========================================
// ✅ MIDDLEWARE - PROTECT ROUTES
// ==========================================

const protect = (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ 
      success: false, 
      error: 'Not authenticated' 
    });
  }
  next();
};

// ==========================================
// ✅ CREATE GMAIL FILTER
// ==========================================

router.post('/create', protect, async (req, res) => {
  try {
    console.log('🔧 POST /api/filters/create called');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ 
        success: false, 
        error: 'Not authenticated' 
      });
    }

    const { filter } = req.body;

    if (!filter || !filter.name || !filter.conditions || !filter.actions) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid filter data' 
      });
    }

    console.log('🔧 Creating Gmail filter:', filter.name);
    console.log('🔐 User googleTokens:', req.user.googleTokens ? 'Present' : 'Missing');

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    oauth2Client.setCredentials({
  access_token: req.user.googleTokens.access_token,
  refresh_token: req.user.googleTokens.refresh_token,
  scope: req.user.googleTokens.scope,
  token_type: req.user.googleTokens.token_type,
  expiry_date: req.user.googleTokens.expiry_date
});

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Build Gmail filter criteria
    const criteria = buildGmailCriteria(filter.conditions);
    
    // Build Gmail filter actions (pass gmail instance)
    const action = await buildGmailActions(filter.actions, gmail);

    console.log('📋 Filter criteria:', JSON.stringify(criteria, null, 2));
    console.log('⚡ Filter actions:', JSON.stringify(action, null, 2));

    // Create the filter
    const gmailFilter = await gmail.users.settings.filters.create({
      userId: 'me',
      requestBody: {
        criteria: criteria,
        action: action
      }
    });

    console.log('✅ Gmail filter created:', gmailFilter.data.id);

    res.json({
      success: true,
      filterId: gmailFilter.data.id,
      message: `Filter "${filter.name}" created in Gmail`,
      gmailFilter: gmailFilter.data
    });

  } catch (error) {
    console.error('❌ Error creating Gmail filter:', error);
    
    // ✅ Better error handling for permission issues
    if (error.message && error.message.includes('insufficient')) {
      return res.status(403).json({ 
        success: false, 
        error: 'Insufficient Permission: Please re-authenticate your Gmail account with the required permissions.',
        needsReauth: true
      });
    }
    
    if (error.code === 401 || error.code === 403) {
      return res.status(403).json({ 
        success: false, 
        error: 'Gmail permission denied. Please re-authenticate.',
        needsReauth: true
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create filter'
    });
  }
});

// ==========================================
// ✅ LIST ALL GMAIL FILTERS
// ==========================================

router.get('/list', protect, async (req, res) => {
  try {
    console.log('📋 GET /api/filters/list called');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ 
        success: false, 
        error: 'Not authenticated' 
      });
    }
// ==========================================
// ✅ CHECK AUTH STATUS
// ==========================================

router.get('/check', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        email: req.user.email,
        name: req.user.name,
        picture: req.user.picture,
        scopes: req.user.googleTokens?.scope || 'no scopes saved'
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});
// ✅ Check if user has Google tokens
if (!req.user.googleTokens || !req.user.googleTokens.access_token) {
  return res.status(403).json({
    success: false,
    error: 'Gmail not connected. Please reconnect your account.',
    needsReauth: true
  });
}

console.log('🔐 Using tokens with scope:', req.user.googleTokens.scope);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  access_token: req.user.googleTokens.access_token,
  refresh_token: req.user.googleTokens.refresh_token,
  scope: req.user.googleTokens.scope,
  token_type: req.user.googleTokens.token_type,
  expiry_date: req.user.googleTokens.expiry_date
});

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.settings.filters.list({
      userId: 'me'
    });

    const filters = response.data.filter || [];
    
    console.log(`✅ Found ${filters.length} Gmail filters`);

    res.json({
      success: true,
      filters: filters,
      total: filters.length
    });

  } catch (error) {
    console.error('❌ Error listing Gmail filters:', error);
    
    if (error.code === 401 || error.code === 403) {
      return res.status(403).json({ 
        success: false, 
        error: 'Permission denied',
        needsReauth: true
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// ✅ DELETE GMAIL FILTER
// ==========================================

router.delete('/:filterId', protect, async (req, res) => {
  try {
    console.log('🗑️ DELETE /api/filters/:filterId called');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ 
        success: false, 
        error: 'Not authenticated' 
      });
    }

    const { filterId } = req.params;

    if (!filterId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Filter ID required' 
      });
    }

    console.log('🗑️ Deleting Gmail filter:', filterId);

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
  access_token: req.user.googleTokens.access_token,
  refresh_token: req.user.googleTokens.refresh_token,
  scope: req.user.googleTokens.scope,
  token_type: req.user.googleTokens.token_type,
  expiry_date: req.user.googleTokens.expiry_date
});

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.settings.filters.delete({
      userId: 'me',
      id: filterId
    });

    console.log('✅ Gmail filter deleted');

    res.json({
      success: true,
      message: 'Filter deleted from Gmail'
    });

  } catch (error) {
    console.error('❌ Error deleting Gmail filter:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// ✅ APPLY FILTER TO EXISTING EMAILS
// ==========================================

router.post('/apply', protect, async (req, res) => {
  try {
    console.log('⚡ POST /api/filters/apply called');
    
    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({ 
        success: false, 
        error: 'Not authenticated' 
      });
    }

    const { filter } = req.body;

    if (!filter || !filter.conditions || !filter.actions) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid filter data' 
      });
    }

    console.log('⚡ Applying filter to existing emails:', filter.name);

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
  access_token: req.user.googleTokens.access_token,
  refresh_token: req.user.googleTokens.refresh_token,
  scope: req.user.googleTokens.scope,
  token_type: req.user.googleTokens.token_type,
  expiry_date: req.user.googleTokens.expiry_date
});

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const query = buildSearchQuery(filter.conditions);
    
    console.log('🔍 Search query:', query);

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100
    });

    const messages = response.data.messages || [];
    
    if (messages.length === 0) {
      console.log('ℹ️ No matching emails found');
      return res.json({
        success: true,
        message: 'No matching emails found',
        count: 0
      });
    }

    console.log(`📧 Found ${messages.length} matching emails`);

    const emailIds = messages.map(m => m.id);
    const actionResults = await applyActionsToEmails(gmail, emailIds, filter.actions);

    console.log(`✅ Applied filter to ${messages.length} emails`);

    res.json({
      success: true,
      message: `Filter applied to ${messages.length} email(s)`,
      count: messages.length,
      actions: actionResults
    });

  } catch (error) {
    console.error('❌ Error applying filter:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
// ==========================================
// ✅ TEST FILTER — Check how many emails match
// ==========================================

router.post('/test', protect, async (req, res) => {
  try {
    console.log('🧪 POST /api/filters/test called');

    if (!req.user || !req.user.googleTokens) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { filter } = req.body;

    if (!filter || !filter.conditions) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter data'
      });
    }

    console.log('🧪 Testing filter:', filter.name);

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token: req.user.googleTokens.access_token,
      refresh_token: req.user.googleTokens.refresh_token,
      scope: req.user.googleTokens.scope,
      token_type: req.user.googleTokens.token_type,
      expiry_date: req.user.googleTokens.expiry_date
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Reuse existing buildSearchQuery helper
    const query = buildSearchQuery(filter.conditions);
    console.log('🔍 Test search query:', query);

    if (!query.trim()) {
      return res.json({
        success: true,
        count: 0,
        emails: [],
        query: query
      });
    }

    // Search Gmail
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 25 // limit para hindi heavy ang API call
    });

    const messages = response.data.messages || [];
    console.log(`🧪 Found ${messages.length} matching emails`);

    // Fetch details ng bawat email (sender, subject, snippet)
    const emails = [];
    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        });

        const headers = detail.data.payload?.headers || [];
        const getHeader = (name) =>
          (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';

        emails.push({
          id: msg.id,
          sender: getHeader('From'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          snippet: detail.data.snippet || ''
        });
      } catch (e) {
        console.warn('⚠️ Could not fetch email detail:', msg.id, e.message);
      }
    }

    res.json({
      success: true,
      count: emails.length,
      emails: emails,
      query: query
    });

  } catch (error) {
    console.error('❌ Error testing filter:', error);

    if (error.code === 401 || error.code === 403) {
      return res.status(403).json({
        success: false,
        error: 'Permission denied. Please re-authenticate.',
        needsReauth: true
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to test filter'
    });
  }
});
// ==========================================
// 🛠️ HELPER FUNCTIONS
// ==========================================

function buildGmailCriteria(conditions) {
  const criteria = {};
  
  conditions.forEach(condition => {
    const { field, operator, value } = condition;
    
    if (field === 'sender') {
      if (operator === 'contains' || operator === 'equals') {
        criteria.from = value;
      }
    }
    
    if (field === 'subject') {
      if (operator === 'contains' || operator === 'equals') {
        criteria.subject = value;
      }
    }
    
    if (field === 'body') {
      if (operator === 'contains') {
        criteria.query = value;
      }
    }
  });
  
  return criteria;
}

async function buildGmailActions(actions, gmail) {
  const action = {};
  
  for (const act of actions) {
    const { type, value } = act;
    
    if (type === 'label') {
      const labelId = await getOrCreateLabel(gmail, value);
      if (!action.addLabelIds) action.addLabelIds = [];
      action.addLabelIds.push(labelId);
    }
    
    if (type === 'archive') {
      if (!action.removeLabelIds) action.removeLabelIds = [];
      action.removeLabelIds.push('INBOX');
    }
    
    if (type === 'star') {
      if (!action.addLabelIds) action.addLabelIds = [];
      action.addLabelIds.push('STARRED');
    }
    
    if (type === 'category') {
      const categoryMap = {
        'primary': 'CATEGORY_PERSONAL',
        'social': 'CATEGORY_SOCIAL',
        'promotions': 'CATEGORY_PROMOTIONS',
        'updates': 'CATEGORY_UPDATES',
        'forums': 'CATEGORY_FORUMS'
      };
      
      const categoryLabel = categoryMap[value.toLowerCase()];
      if (categoryLabel) {
        if (!action.addLabelIds) action.addLabelIds = [];
        action.addLabelIds.push(categoryLabel);
      }
    }
  }
  
  return action;
}

async function getOrCreateLabel(gmail, labelName) {
  try {
    const labelsResponse = await gmail.users.labels.list({
      userId: 'me'
    });
    
    const labels = labelsResponse.data.labels || [];
    const existingLabel = labels.find(l => l.name === labelName);
    
    if (existingLabel) {
      console.log(`📌 Using existing label: ${labelName}`);
      return existingLabel.id;
    }
    
    console.log(`📌 Creating new label: ${labelName}`);
    const newLabel = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      }
    });
    
    return newLabel.data.id;
    
  } catch (error) {
    console.error('❌ Error with label:', error);
    throw error;
  }
}

function buildSearchQuery(conditions) {
  const queryParts = [];
  
  conditions.forEach(condition => {
    const { field, operator, value } = condition;
    
    if (field === 'sender') {
      if (operator === 'contains') {
        queryParts.push(`from:*${value}*`);
      } else if (operator === 'equals') {
        queryParts.push(`from:${value}`);
      } else if (operator === 'ends with') {
        queryParts.push(`from:*${value}`);
      }
    }
    
    if (field === 'subject') {
      if (operator === 'contains') {
        queryParts.push(`subject:${value}`);
      } else if (operator === 'equals') {
        queryParts.push(`subject:"${value}"`);
      } else if (operator === 'starts with') {
        queryParts.push(`subject:${value}*`);
      }
    }
    
    if (field === 'body') {
      if (operator === 'contains') {
        queryParts.push(value);
      }
    }
    
    if (field === 'category') {
      const categoryMap = {
        'primary': 'category:primary',
        'social': 'category:social',
        'promotions': 'category:promotions',
        'updates': 'category:updates',
        'forums': 'category:forums'
      };
      
      const categoryQuery = categoryMap[value.toLowerCase()];
      if (categoryQuery) {
        if (operator === 'is') {
          queryParts.push(categoryQuery);
        } else if (operator === 'is not') {
          queryParts.push(`-${categoryQuery}`);
        }
      }
    }
  });
  
  return queryParts.join(' ');
}

async function applyActionsToEmails(gmail, emailIds, actions) {
  const results = {
    labeled: 0,
    archived: 0,
    starred: 0
  };
  
  for (const action of actions) {
    const { type, value } = action;
    
    if (type === 'label') {
      const labelId = await getOrCreateLabel(gmail, value);
      
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids: emailIds,
          addLabelIds: [labelId]
        }
      });
      
      results.labeled = emailIds.length;
      console.log(`✅ Added label "${value}" to ${emailIds.length} emails`);
    }
    
    if (type === 'archive') {
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids: emailIds,
          removeLabelIds: ['INBOX']
        }
      });
      
      results.archived = emailIds.length;
      console.log(`✅ Archived ${emailIds.length} emails`);
    }
    
    if (type === 'star') {
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids: emailIds,
          addLabelIds: ['STARRED']
        }
      });
      
      results.starred = emailIds.length;
      console.log(`✅ Starred ${emailIds.length} emails`);
    }
  }
  
  return results;
}

module.exports = router;