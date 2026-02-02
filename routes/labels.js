const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { google } = require('googleapis');
const User = require('../models/User');
const logger = require('../utils/logger');

// ✅ FIXED: Helper function to get Gmail client
const getGmailClient = (user) => {
  if (!user || !user.googleTokens) {
    throw new Error('User not authenticated or missing Google tokens');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: user.googleTokens.access_token,
    refresh_token: user.googleTokens.refresh_token,
    scope: user.googleTokens.scope,
    token_type: user.googleTokens.token_type,
    expiry_date: user.googleTokens.expiry_date
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
};

// ✅ GET all labels/folders
router.get('/', protect, async (req, res) => {
  try {
    const gmail = getGmailClient(req.user);
    
    const response = await gmail.users.labels.list({
      userId: 'me',
    });

    const labels = response.data.labels || [];
    
    // Filter out system labels if you want
    const userLabels = labels.filter(label => 
      label.type === 'user' // Only user-created labels
    );

    logger.info(`✅ Fetched ${labels.length} labels for user: ${req.user.email}`);

    res.json({
      success: true,
      labels: labels, // All labels including system
      userLabels: userLabels, // Only user-created labels
      count: labels.length
    });

  } catch (error) {
    logger.error('Get labels error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch labels',
      details: error.message
    });
  }
});

// ✅ CREATE new label/folder
router.post('/', protect, async (req, res) => {
  try {
    const { name, labelListVisibility, messageListVisibility } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Label name is required'
      });
    }

    const gmail = getGmailClient(req.user);

    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: name,
        labelListVisibility: labelListVisibility || 'labelShow',
        messageListVisibility: messageListVisibility || 'show',
      },
    });

    logger.info(`✅ Label created: ${name} for user: ${req.user.email}`);

    res.json({
      success: true,
      label: response.data,
      message: `Label "${name}" created successfully`
    });

  } catch (error) {
    logger.error('Create label error:', error);
    
    if (error.code === 409 || error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: 'Label already exists',
        details: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create label',
      details: error.message
    });
  }
});

// ✅ UPDATE label (rename or change visibility)
router.put('/:labelId', protect, async (req, res) => {
  try {
    const { labelId } = req.params;
    const { name, labelListVisibility, messageListVisibility } = req.body;

    const gmail = getGmailClient(req.user);

    const updateData = {};
    if (name) updateData.name = name;
    if (labelListVisibility) updateData.labelListVisibility = labelListVisibility;
    if (messageListVisibility) updateData.messageListVisibility = messageListVisibility;

    const response = await gmail.users.labels.update({
      userId: 'me',
      id: labelId,
      requestBody: updateData,
    });

    logger.info(`✅ Label updated: ${labelId} for user: ${req.user.email}`);

    res.json({
      success: true,
      label: response.data,
      message: 'Label updated successfully'
    });

  } catch (error) {
    logger.error('Update label error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update label',
      details: error.message
    });
  }
});

// ✅ DELETE label/folder
router.delete('/:labelId', protect, async (req, res) => {
  try {
    const { labelId } = req.params;

    const gmail = getGmailClient(req.user);

    await gmail.users.labels.delete({
      userId: 'me',
      id: labelId,
    });

    logger.info(`✅ Label deleted: ${labelId} for user: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Label deleted successfully'
    });

  } catch (error) {
    logger.error('Delete label error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete label',
      details: error.message
    });
  }
});

// ✅ APPLY label to emails
router.post('/apply', protect, async (req, res) => {
  try {
    const { emailIds, labelIds } = req.body;

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'emailIds array is required'
      });
    }

    if (!labelIds || !Array.isArray(labelIds) || labelIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'labelIds array is required'
      });
    }

    const gmail = getGmailClient(req.user);

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: emailIds,
        addLabelIds: labelIds,
      },
    });

    logger.info(`✅ Labels applied to ${emailIds.length} emails for user: ${req.user.email}`);

    res.json({
      success: true,
      message: `Labels applied to ${emailIds.length} emails`,
      emailCount: emailIds.length,
      labelCount: labelIds.length
    });

  } catch (error) {
    logger.error('Apply labels error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to apply labels',
      details: error.message
    });
  }
});

// ✅ REMOVE label from emails
router.post('/remove', protect, async (req, res) => {
  try {
    const { emailIds, labelIds } = req.body;

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'emailIds array is required'
      });
    }

    if (!labelIds || !Array.isArray(labelIds) || labelIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'labelIds array is required'
      });
    }

    const gmail = getGmailClient(req.user);

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: emailIds,
        removeLabelIds: labelIds,
      },
    });

    logger.info(`✅ Labels removed from ${emailIds.length} emails for user: ${req.user.email}`);

    res.json({
      success: true,
      message: `Labels removed from ${emailIds.length} emails`,
      emailCount: emailIds.length,
      labelCount: labelIds.length
    });

  } catch (error) {
    logger.error('Remove labels error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove labels',
      details: error.message
    });
  }
});

module.exports = router;