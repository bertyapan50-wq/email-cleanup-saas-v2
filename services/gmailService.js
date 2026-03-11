const { google } = require('googleapis');
const { oauth2Client } = require('../config/oauth');
const logger = require('../utils/logger');

class GmailService {
<<<<<<< HEAD
  async getGmailClient(refreshToken) {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.gmail({ version: 'v1', auth: oauth2Client });
  }
=======
  async getGmailClient(tokens) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({
    access_token: tokens.access_token || tokens,
    refresh_token: tokens.refresh_token || null
  });
  return google.gmail({ version: 'v1', auth: oauth2 });
}
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f

  async fetchEmails(refreshToken, maxResults = 50) {
    try {
      const gmail = await this.getGmailClient(refreshToken);
      const response = await gmail.users.messages.list({ userId: 'me', maxResults, q: '-in:trash -in:spam' });
      if (!response.data.messages) return [];

      const emails = await Promise.all(
        response.data.messages.slice(0, 20).map(async (message) => {
          const email = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
          });
          const headers = email.data.payload.headers;
          return {
            id: email.data.id,
            sender: headers.find(h => h.name === 'From')?.value || '',
            subject: headers.find(h => h.name === 'Subject')?.value || '',
            date: headers.find(h => h.name === 'Date')?.value || '',
            snippet: email.data.snippet,
            labels: email.data.labelIds || []
          };
        })
      );

      return emails;
    } catch (error) {
      logger.error('Gmail fetch error:', error);
      throw error;
    }
  }

  async executeAction(refreshToken, emailId, action) {
    try {
      const gmail = await this.getGmailClient(refreshToken);
      switch (action) {
        case 'delete':
          await gmail.users.messages.trash({ userId: 'me', id: emailId });
          break;
        case 'archive':
          await gmail.users.messages.modify({ userId: 'me', id: emailId, requestBody: { removeLabelIds: ['INBOX'] } });
          break;
        case 'mark_spam':
          await gmail.users.messages.modify({ userId: 'me', id: emailId, requestBody: { addLabelIds: ['SPAM'] } });
          break;
      }
      return { success: true };
    } catch (error) {
      logger.error('Gmail action error:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  // ✅ NEW: Batch archive emails
  async archiveEmails(tokens, emailIds) {
    try {
      const gmail = await this.getGmailClient(tokens.refresh_token);
      
      // Archive in batches of 10 to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < emailIds.length; i += batchSize) {
        const batch = emailIds.slice(i, i + batchSize);
        
=======
  // ✅ Batch archive emails
  async archiveEmails(tokens, emailIds) {
    try {
      const gmail = await this.getGmailClient(tokens.refresh_token);
      const batchSize = 10;
      for (let i = 0; i < emailIds.length; i += batchSize) {
        const batch = emailIds.slice(i, i + batchSize);
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
        await Promise.all(
          batch.map(emailId =>
            gmail.users.messages.modify({
              userId: 'me',
              id: emailId,
              requestBody: { removeLabelIds: ['INBOX'] }
            })
          )
        );
      }
<<<<<<< HEAD
      
=======
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
      logger.info(`Archived ${emailIds.length} emails`);
      return { success: true, count: emailIds.length };
    } catch (error) {
      logger.error('Archive emails error:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  // ✅ NEW: Batch delete emails
  async deleteEmails(tokens, emailIds) {
    try {
      const gmail = await this.getGmailClient(tokens.refresh_token);
      
      // Delete in batches of 10 to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < emailIds.length; i += batchSize) {
        const batch = emailIds.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(emailId =>
            gmail.users.messages.trash({
              userId: 'me',
              id: emailId
            })
          )
        );
      }
      
=======
  // ✅ Batch delete emails
  async deleteEmails(tokens, emailIds) {
    try {
      const gmail = await this.getGmailClient(tokens.refresh_token);
      const batchSize = 10;
      for (let i = 0; i < emailIds.length; i += batchSize) {
        const batch = emailIds.slice(i, i + batchSize);
        await Promise.all(
          batch.map(emailId =>
            gmail.users.messages.trash({ userId: 'me', id: emailId })
          )
        );
      }
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
      logger.info(`Deleted ${emailIds.length} emails`);
      return { success: true, count: emailIds.length };
    } catch (error) {
      logger.error('Delete emails error:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  // ✅ NEW: Get inbox emails (for scheduler)
=======
  // ✅ Get inbox emails (for scheduler)
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
  async getInboxEmails(tokens, maxResults = 100) {
    try {
if (!tokens || !tokens.refresh_token) {
        logger.warn('getInboxEmails called with missing tokens — skipping');
        return [];
      }

      const gmail = await this.getGmailClient(tokens.refresh_token);
<<<<<<< HEAD
      
=======
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults,
        labelIds: ['INBOX'],
        q: '-in:trash -in:spam'
      });

<<<<<<< HEAD
      if (!response.data.messages) {
        return [];
      }

      // Fetch details for all emails
=======
      if (!response.data.messages) return [];

>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
      const emails = await Promise.all(
        response.data.messages.map(async (message) => {
          const email = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
          });
<<<<<<< HEAD
          
=======
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
          const headers = email.data.payload.headers;
          return {
            emailId: email.data.id,
            from: headers.find(h => h.name === 'From')?.value || '',
            subject: headers.find(h => h.name === 'Subject')?.value || '',
            date: headers.find(h => h.name === 'Date')?.value || '',
            snippet: email.data.snippet,
            labels: email.data.labelIds || []
          };
        })
      );

      return emails;
    } catch (error) {
      logger.error('Get inbox emails error:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  // ✅ Existing: Create Gmail label
=======
  // ✅ Create Gmail label
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
  async createLabel(tokens, name) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(tokens);
<<<<<<< HEAD

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody: { 
        name, 
        labelListVisibility: 'labelShow', 
        messageListVisibility: 'show' 
      }
    });

    return response.data;
  }

  // ✅ Existing: Summarize emails by category
  async summarizeEmails(emails) {
    const summaries = {};
    const categories = ['Work', 'Promotions', 'Personal'];

=======
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      }
    });
    return response.data;
  }

  // ✅ Summarize emails by category
  async summarizeEmails(emails) {
    const summaries = {};
    const categories = ['Work', 'Promotions', 'Personal'];
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
    categories.forEach(cat => {
      const catEmails = emails.filter(e => e.labels.includes(cat));
      summaries[cat] = catEmails.map(e => ({
        subject: e.subject,
        from: e.sender,
        snippet: e.snippet
      }));
    });
<<<<<<< HEAD

    return summaries;
  }
=======
    return summaries;
  }

  // ✅ NEW: Send a single email via Gmail API
  async sendEmail(refreshToken, { to, subject, body, fromName }) {
    try {
      const gmail = await this.getGmailClient(refreshToken);

      // Get sender profile for the From header
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const fromEmail = profile.data.emailAddress;
      const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

      // Build RFC 2822 raw email
      const emailLines = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        body
      ];

      const rawEmail = emailLines.join('\r\n');
      const encodedEmail = Buffer.from(rawEmail)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedEmail }
      });

      logger.info(`✅ Email sent to ${to}, messageId: ${result.data.id}`);
      return { success: true, messageId: result.data.id, to };
    } catch (error) {
      logger.error(`❌ Failed to send email to ${to}:`, error.message);
      return { success: false, to, error: error.message };
    }
  }

  // ✅ NEW: Send broadcast emails in batches with delay to avoid rate limits
  async sendBroadcast(refreshToken, emails, delayMs = 1000) {
    const results = [];
    const batchSize = 5;

    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(email => this.sendEmail(refreshToken, email))
      );

      results.push(...batchResults);

      // Delay between batches to respect Gmail rate limits
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    logger.info(`📤 Broadcast complete: ${sent} sent, ${failed} failed`);
    return { results, sent, failed, total: emails.length };
  }
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
}

module.exports = new GmailService();