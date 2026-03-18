const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const AutoRule = require('../models/AutoRule');
const Activity = require('../models/Activity');
const { google } = require('googleapis');

// GET all rules
router.get('/', protect, async (req, res) => {
  try {
    const rules = await AutoRule.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, rules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CREATE rule
router.post('/', protect, async (req, res) => {
  try {
    const { name, prompt, action, label, enabled } = req.body;
    if (!name || !prompt || !action) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    const rule = await AutoRule.create({ 
      userId: req.user._id, name, prompt, action, label, enabled 
    });
    res.json({ success: true, rule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// UPDATE rule
router.put('/:id', protect, async (req, res) => {
  try {
    const rule = await AutoRule.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
    res.json({ success: true, rule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE rule
router.delete('/:id', protect, async (req, res) => {
  try {
    await AutoRule.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// RUN rules against inbox
router.post('/run', protect, async (req, res) => {
  try {
    const { writingStyle = 'Professional', instructions = '' } = req.body;
    const rules = await AutoRule.find({ userId: req.user._id, enabled: true });
    if (rules.length === 0) {
      return res.json({ success: true, processed: 0, message: 'No active rules' });
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

    const listRes = await gmail.users.messages.list({
      userId: 'me', labelIds: ['INBOX'], maxResults: 100
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      return res.json({ success: true, processed: 0, message: 'Inbox is empty' });
    }

    const emailDetails = await Promise.all(
      messages.map(msg =>
        gmail.users.messages.get({
          userId: 'me', id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject']
        }).catch(() => null)
      )
    );

    const actionMap = {
      archive: 'auto_archive',
      delete: 'auto_delete',
      label: 'auto_label',
      star: 'auto_star',
      notify: 'general_action'
    };

    const results = [];

    for (const rule of rules) {
      const keywords = rule.prompt.toLowerCase()
        .split(/[\s,]+/)
        .filter(k => k.length > 3);

      const matchedIds = emailDetails
        .filter(detail => {
          if (!detail) return false;
          const headers = detail.data.payload.headers;
          const from = (headers.find(h => h.name === 'From')?.value || '').toLowerCase();
          const subject = (headers.find(h => h.name === 'Subject')?.value || '').toLowerCase();
          return keywords.some(k => from.includes(k) || subject.includes(k));
        })
        .map(d => d.data.id);

      if (matchedIds.length === 0) continue;

      try {
        if (rule.action === 'archive') {
          await gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: { ids: matchedIds, removeLabelIds: ['INBOX'] }
          });
        } else if (rule.action === 'delete') {
          await gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: { ids: matchedIds, addLabelIds: ['TRASH'] }
          });
        } else if (rule.action === 'star') {
          await gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: { ids: matchedIds, addLabelIds: ['STARRED'] }
          });
        } else if (rule.action === 'label' && rule.label) {
          const labelsRes = await gmail.users.labels.list({ userId: 'me' });
          let gmailLabel = labelsRes.data.labels.find(
            l => l.name.toLowerCase() === rule.label.toLowerCase()
          );
          if (!gmailLabel) {
            const created = await gmail.users.labels.create({
              userId: 'me',
              requestBody: { name: rule.label }
            });
            gmailLabel = created.data;
          }
          await gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: { ids: matchedIds, addLabelIds: [gmailLabel.id] }
          });
        }

        results.push({ rule: rule.name, action: rule.action, count: matchedIds.length });

        await Activity.create({
          userId: req.user._id,
          action: actionMap[rule.action] || 'general_action',
          description: `Auto Action "${rule.name}" — ${rule.action}d ${matchedIds.length} email(s)`,
          status: 'success',
          details: { count: matchedIds.length, rule: rule.name }
        });

      } catch (actionErr) {
        console.error(`❌ Rule "${rule.name}" failed:`, actionErr.message);
      }
    }

    const totalProcessed = results.reduce((sum, r) => sum + r.count, 0);
    res.json({ success: true, processed: totalProcessed, results });

  } catch (err) {
    console.error('❌ /rules/run error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;