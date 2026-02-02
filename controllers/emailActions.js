const { google } = require('googleapis');
const logger = require('../utils/logger');

// Helper function to get tokens from session
const getTokensFromSession = (req) => {
  if (req.session?.passport?.user) {
    const passportUser = req.session.passport.user;
    return {
      access_token: passportUser.accessToken,
      refresh_token: passportUser.refreshToken
    };
  } else if (req.user) {
    return {
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken
    };
  }
  return null;
};

// Helper function to create Gmail client
const createGmailClient = (tokens) => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials(tokens);
  return google.gmail({ version: 'v1', auth });
};

/**
 * Reply to email
 */
exports.replyToEmail = async (req, res) => {
  try {
    const { emailId } = req.params;
    const { replyText } = req.body;
    
    logger.info(`📧 Replying to email: ${emailId}`);
    
    if (!replyText) {
      return res.status(400).json({ 
        success: false, 
        message: 'Reply text is required' 
      });
    }

    const tokens = getTokensFromSession(req);
    if (!tokens) {
      return res.status(401).json({ 
        success: false, 
        message: 'Not authenticated' 
      });
    }

    const gmail = createGmailClient(tokens);

    // Get original email
    const originalEmail = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full'
    });

    const headers = originalEmail.data.payload.headers;
    const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

    const from = getHeader('From');
    const subject = getHeader('Subject');
    const messageId = getHeader('Message-ID');

    // Create reply
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    
    const rawMessage = [
      `To: ${from}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${messageId}`,
      '',
      replyText
    ].join('\n');

    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: originalEmail.data.threadId
      }
    });

    logger.info('✅ Reply sent successfully!');

    res.json({ 
      success: true, 
      message: 'Reply sent successfully!' 
    });

  } catch (error) {
    logger.error('Reply error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send reply',
      error: error.message 
    });
  }
};

/**
 * Archive single email
 */
exports.archiveSingleEmail = async (req, res) => {
  try {
    const { emailId } = req.params;
    
    logger.info(`📦 Archiving email: ${emailId}`);

    const tokens = getTokensFromSession(req);
    if (!tokens) {
      return res.status(401).json({ 
        success: false, 
        message: 'Not authenticated' 
      });
    }

    const gmail = createGmailClient(tokens);

    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: {
        removeLabelIds: ['INBOX']
      }
    });

    logger.info('✅ Email archived successfully!');

    res.json({ 
      success: true, 
      message: 'Email archived successfully!' 
    });

  } catch (error) {
    logger.error('Archive error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to archive email',
      error: error.message 
    });
  }
};

/**
 * Delete single email
 */
exports.deleteSingleEmail = async (req, res) => {
  try {
    const { emailId } = req.params;
    
    logger.info(`🗑️ Deleting email: ${emailId}`);

    const tokens = getTokensFromSession(req);
    if (!tokens) {
      return res.status(401).json({ 
        success: false, 
        message: 'Not authenticated' 
      });
    }

    const gmail = createGmailClient(tokens);

    await gmail.users.messages.trash({
      userId: 'me',
      id: emailId
    });

    logger.info('✅ Email deleted successfully!');

    res.json({ 
      success: true, 
      message: 'Email deleted successfully!' 
    });

  } catch (error) {
    logger.error('Delete error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete email',
      error: error.message 
    });
  }
};

/**
 * Star/unstar email
 */
exports.starEmail = async (req, res) => {
  try {
    const { emailId } = req.params;
    const { starred } = req.body;
    
    logger.info(`⭐ ${starred ? 'Starring' : 'Unstarring'} email: ${emailId}`);

    const tokens = getTokensFromSession(req);
    if (!tokens) {
      return res.status(401).json({ 
        success: false, 
        message: 'Not authenticated' 
      });
    }

    const gmail = createGmailClient(tokens);

    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: starred 
        ? { addLabelIds: ['STARRED'] }
        : { removeLabelIds: ['STARRED'] }
    });

    logger.info(`✅ Email ${starred ? 'starred' : 'unstarred'}!`);

    res.json({ 
      success: true, 
      message: `Email ${starred ? 'starred' : 'unstarred'}!`,
      starred 
    });

  } catch (error) {
    logger.error('Star error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to star/unstar email',
      error: error.message 
    });
  }
};