const { google } = require('googleapis');
const { oauth2Client } = require('../config/oauth');
const logger = require('../utils/logger');

class GmailService {
  async getGmailClient(refreshToken) {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

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

  // ✅ NEW: Batch archive emails
  async archiveEmails(tokens, emailIds) {
    try {
      const gmail = await this.getGmailClient(tokens.refresh_token);
      
      // Archive in batches of 10 to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < emailIds.length; i += batchSize) {
        const batch = emailIds.slice(i, i + batchSize);
        
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
      
      logger.info(`Archived ${emailIds.length} emails`);
      return { success: true, count: emailIds.length };
    } catch (error) {
      logger.error('Archive emails error:', error);
      throw error;
    }
  }

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
      
      logger.info(`Deleted ${emailIds.length} emails`);
      return { success: true, count: emailIds.length };
    } catch (error) {
      logger.error('Delete emails error:', error);
      throw error;
    }
  }

  // ✅ NEW: Get inbox emails (for scheduler)
  async getInboxEmails(tokens, maxResults = 100) {
    try {
      const gmail = await this.getGmailClient(tokens.refresh_token);
      
      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults,
        labelIds: ['INBOX'],
        q: '-in:trash -in:spam'
      });

      if (!response.data.messages) {
        return [];
      }

      // Fetch details for all emails
      const emails = await Promise.all(
        response.data.messages.map(async (message) => {
          const email = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
          });
          
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

  // ✅ Existing: Create Gmail label
  async createLabel(tokens, name) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(tokens);

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

    categories.forEach(cat => {
      const catEmails = emails.filter(e => e.labels.includes(cat));
      summaries[cat] = catEmails.map(e => ({
        subject: e.subject,
        from: e.sender,
        snippet: e.snippet
      }));
    });

    return summaries;
  }
}

module.exports = new GmailService();