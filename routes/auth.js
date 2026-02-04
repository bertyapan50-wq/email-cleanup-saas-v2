const express = require('express');
const router = express.Router();
const passport = require('passport');
const { google } = require('googleapis');

// ✅ Helper to get Gmail client with auto token refresh
async function getGmailClientWithRefresh(user) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken
  });

  // ✅ Set up automatic token refresh
  oauth2Client.on('tokens', async (tokens) => {
    console.log('🔄 Token refreshed!');
    if (tokens.refresh_token) {
      user.refreshToken = tokens.refresh_token;
    }
    user.accessToken = tokens.access_token;
    
    // Only save if user has a save method (database model)
    if (user.save && typeof user.save === 'function') {
      await user.save();
    }
  });

  // ✅ Force refresh if needed
  try {
    await oauth2Client.getAccessToken();
  } catch (error) {
    console.error('❌ Token refresh failed:', error.message);
    throw new Error('Authentication expired. Please log in again.');
  }

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// ================================
// Google OAuth login
router.get('/google', passport.authenticate('google', {
  scope: [
    'profile',
    'email', 
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.readonly'
  ],
  accessType: 'offline',    // ✅ CRITICAL - Gets refresh token
  prompt: 'consent'         // ✅ CRITICAL - Forces consent screen
}));

// ================================
// Google OAuth callback
// ================================
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}` }),
  (req, res) => {
    console.log('✅ OAuth successful, user logged in:', req.user.email);
    console.log('🔑 User GoogleId:', req.user.googleId); // ✅ Check if this logs
    res.redirect(`${process.env.FRONTEND_URL}?auth=success`);
  }
);

// ================================
// Get current user
// ================================
router.get('/user', async (req, res) => {
  // ✅ Check for Bearer token first (para sa cross-domain)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const User = require('../models/User');
      const user = await User.findById(decoded.id);
      
      if (user) {
        return res.json({
          success: true,
          user: {
            id: user._id,
            email: user.email,
            name: user.name,
            googleId: user.googleId,
            subscriptionTier: user.subscriptionTier,
            subscriptionStatus: user.subscriptionStatus,
            trialEndDate: user.trialEndDate,
            trialUsed: user.trialUsed,
            freeCleanupCount: user.freeCleanupCount,
            totalCleanupsUsed: user.totalCleanupsUsed
          }
        });
      }
    } catch (err) {
      console.error('Token verification failed:', err.message);
    }
  }

  // Existing session check — huwag baguhin ang nasa dito pababa
  console.log('📥 GET /api/auth/user');
  console.log('🔐 Is Authenticated:', req.isAuthenticated());
  console.log('👤 User:', req.user);
  
  if (req.isAuthenticated()) {
    try {
      // ✅ Fetch full user data from database
      const User = require('../models/User');
      const user = await User.findById(req.user._id || req.user.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          picture: req.user.picture,
          googleId: user.googleId,
          subscriptionTier: user.subscriptionTier,
          subscriptionStatus: user.subscriptionStatus,
          // ✅ TRIAL DATA
          trialEndDate: user.trialEndDate,
          trialUsed: user.trialUsed,
          freeCleanupCount: user.freeCleanupCount,
          totalCleanupsUsed: user.totalCleanupsUsed
        }
      });
    } catch (error) {
      console.error('❌ Error fetching user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user data'
      });
    }
  } else {
    res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }
});

// ================================
// Logout
// ================================
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    req.session.destroy();
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// ================================
// Debug Session Endpoint
// ================================
router.get('/debug-session', (req, res) => {
  res.json({
    isAuthenticated: req.isAuthenticated(),
    sessionID: req.sessionID,
    user: req.user,
    session: req.session
  });
});

// Helper function to get friendly category name
function getCategoryName(labelIds) {
  if (!labelIds) return 'Other';
  
  if (labelIds.includes('CATEGORY_PROMOTIONS')) return 'Promotions';
  if (labelIds.includes('CATEGORY_SOCIAL')) return 'Social';
  if (labelIds.includes('CATEGORY_UPDATES')) return 'Updates';
  if (labelIds.includes('CATEGORY_FORUMS')) return 'Forums';
  if (labelIds.includes('INBOX')) return 'Primary';
  
  return 'Other';
}

// ================================
// Get ALL emails from Gmail (All Categories)
// ================================
router.get('/emails', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    console.log('📧 Fetching emails for user:', req.user.email);
    console.log('🔑 User GoogleId:', req.user.googleId);
    
    // ✅ Use the helper function with auto token refresh
    const gmail = await getGmailClientWithRefresh(req.user);

    // ✅ Fetch from multiple categories
    const categories = [
      'INBOX',                    // Primary
      'CATEGORY_PROMOTIONS',      // Promotions
      'CATEGORY_SOCIAL',          // Social
      'CATEGORY_UPDATES',         // Updates
      'CATEGORY_FORUMS'           // Forums
    ];

    const maxResultsPerCategory = 100;
    let allEmails = [];

    console.log('🔍 Starting to fetch emails from all categories...');

    // Fetch from each category
    for (const category of categories) {
      try {
        const response = await gmail.users.messages.list({
          userId: 'me',
          labelIds: [category],
          maxResults: maxResultsPerCategory
        });

        const messages = response.data.messages || [];
        console.log(`📧 Found ${messages.length} emails in ${category}`);

        // Get details for each message (in batches to avoid rate limits)
        const batchSize = 10;
        for (let i = 0; i < messages.length; i += batchSize) {
          const batch = messages.slice(i, i + batchSize);
          
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
                  category: getCategoryName(detail.data.labelIds),
                  labelIds: detail.data.labelIds || []
                };
              } catch (error) {
                console.error(`❌ Error fetching email ${message.id}:`, error.message);
                return null;
              }
            })
          );

          // Filter out nulls and add to all emails
          allEmails = allEmails.concat(emailDetails.filter(e => e !== null));
        }
      } catch (error) {
        console.error(`❌ Error fetching ${category}:`, error.message);
      }
    }

    // Remove duplicates (same email can be in multiple categories)
    const uniqueEmails = Array.from(
      new Map(allEmails.map(email => [email.id, email])).values()
    );

    console.log(`✅ Total unique emails fetched: ${uniqueEmails.length}`);

    res.json({ 
      success: true, 
      emails: uniqueEmails,
      total: uniqueEmails.length
    });

  } catch (error) {
    console.error('❌ Error fetching emails:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch emails',
      error: error.message,
      details: error.response?.data
    });
  }
});
// =======================================================
// ✅ GET single email full details
// =======================================================
router.get('/emails/:emailId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    console.log('📧 Fetching full email details for:', req.params.emailId);
    
    const gmail = await getGmailClientWithRefresh(req.user);

    const email = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.emailId,
      format: 'full'
    });

    res.json({
      success: true,
      email: email.data
    });

  } catch (error) {
    console.error('Error fetching email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email',
      error: error.message
    });
  }
});

// =======================================================
// 🔥 TRASH emails (with rate limiting)
// =======================================================
router.post('/delete-emails', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const { emailIds } = req.body;
    if (!emailIds || !Array.isArray(emailIds)) {
      return res.status(400).json({ success: false, message: 'Invalid email IDs' });
    }

    // ✅ Use helper function with token refresh
    const gmail = await getGmailClientWithRefresh(req.user);

    // ✅ Process in small batches with delays to avoid rate limits
    const batchSize = 5;
    const delayBetweenBatches = 1000;
    const results = [];

    console.log(`🗑️ Starting to trash ${emailIds.length} emails in batches of ${batchSize}...`);

    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batch = emailIds.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(emailIds.length / batchSize)}...`);

      const batchResults = await Promise.all(
        batch.map(async (id) => {
          try {
            await gmail.users.messages.trash({ userId: 'me', id });
            console.log(`✅ Successfully trashed email ${id}`);
            return { id, success: true };
          } catch (error) {
            console.error(`❌ Error trashing email ${id}:`, error.message);
            return { id, success: false, error: error.message };
          }
        })
      );

      results.push(...batchResults);

      if (i + batchSize < emailIds.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`✅ Trashing complete: ${successCount} successful, ${failCount} failed`);

    res.json({
      success: true,
      message: `Moved ${successCount} email${successCount !== 1 ? 's' : ''} to trash${failCount > 0 ? ` (${failCount} failed)` : ''}`,
      results
    });

  } catch (error) {
    console.error('Error trashing emails:', error);
    res.status(500).json({ success: false, message: 'Failed to trash emails', error: error.message });
  }
});

// =======================================================
// 🔥 ARCHIVE emails (with rate limiting)
// =======================================================
router.post('/archive-emails', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const { emailIds } = req.body;
    if (!emailIds || !Array.isArray(emailIds)) {
      return res.status(400).json({ success: false, message: 'Invalid email IDs' });
    }

    // ✅ Use helper function with token refresh
    const gmail = await getGmailClientWithRefresh(req.user);

    // ✅ Process in small batches with delays to avoid rate limits
    const batchSize = 5;
    const delayBetweenBatches = 1000;
    const results = [];

    console.log(`📦 Starting to archive ${emailIds.length} emails in batches of ${batchSize}...`);

    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batch = emailIds.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(emailIds.length / batchSize)}...`);

      const batchResults = await Promise.all(
        batch.map(async (id) => {
          try {
            await gmail.users.messages.modify({
              userId: 'me',
              id,
              requestBody: { removeLabelIds: ['INBOX'] }
            });
            console.log(`✅ Successfully archived email ${id}`);
            return { id, success: true };
          } catch (error) {
            console.error(`❌ Error archiving email ${id}:`, error.message);
            return { id, success: false, error: error.message };
          }
        })
      );

      results.push(...batchResults);

      if (i + batchSize < emailIds.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`✅ Archiving complete: ${successCount} successful, ${failCount} failed`);

    res.json({
      success: true,
      message: `Archived ${successCount} email${successCount !== 1 ? 's' : ''}${failCount > 0 ? ` (${failCount} failed)` : ''}`,
      results
    });

  } catch (error) {
    console.error('Error archiving emails:', error);
    res.status(500).json({ success: false, message: 'Failed to archive emails', error: error.message });
  }
});
// ================================
// 🔄 Re-authenticate / Reconnect Gmail
// ================================
router.get('/reauth', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect(`${process.env.FRONTEND_URL}?auth=login`);
  }

  // ✅ Use full backend URL for Google OAuth
  res.redirect(`${process.env.BACKEND_URL}/api/auth/google`);
});



module.exports = router;