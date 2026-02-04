const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const mongoose = require('mongoose');

// =====================
// Follow-up Schema - FIXED to use String for userId
// =====================
const FollowUpSchema = new mongoose.Schema({
  userId: {
    type: String, // ✅ Changed from ObjectId to String (stores Google ID)
    required: true,
    index: true
  },
  emailId: {
    type: String,
    required: true
  },
  emailSubject: String,
  emailFrom: String,
  followUpDate: {
    type: Date,
    required: true
  },
  notes: String,
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending'
  },
  notified: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const FollowUp = mongoose.model('FollowUp', FollowUpSchema);

// ✅ FIXED: Helper function to get userId consistently
const getUserId = (user) => {
  if (!user) {
    throw new Error('User not found in session');
  }
  
  // Priority: googleId > _id (as string)
  if (user.googleId) {
    return user.googleId;
  }
  
  if (user._id) {
    return user._id.toString();
  }
  
  throw new Error('No valid user identifier found');
};

// =====================
// CREATE follow-up - FIXED
// =====================
router.post('/create', protect, async (req, res) => {
  try {
    console.log('📝 CREATE FOLLOW-UP called');
    console.log('🔍 User:', {
      email: req.user?.email,
      googleId: req.user?.googleId,
      _id: req.user?._id
    });
    
    const { emailId, emailSubject, emailFrom, followUpDate, notes, priority } = req.body;

    if (!emailId || !followUpDate) {
      return res.status(400).json({
        success: false,
        error: 'Email ID and follow-up date are required'
      });
    }

    // Validate date is in the future
    const followUpDateTime = new Date(followUpDate);
    if (followUpDateTime < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Follow-up date must be in the future'
      });
    }

    // ✅ FIXED: Use helper function
    const userId = getUserId(req.user);
    console.log('✅ Using userId:', userId);

    const followUp = await FollowUp.create({
      userId: userId,
      emailId,
      emailSubject: emailSubject || 'No subject',
      emailFrom: emailFrom || 'Unknown sender',
      followUpDate: followUpDateTime,
      notes: notes || '',
      priority: priority || 'medium'
    });

    console.log(`✅ Follow-up created: ${followUp._id}`);

    res.status(201).json({
      success: true,
      followUp,
      message: 'Follow-up scheduled successfully'
    });

  } catch (error) {
    console.error('❌ Create follow-up error:', error.message);
    console.error('❌ Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Failed to create follow-up',
      details: error.message
    });
  }
});

// =====================
// GET all follow-ups for user - FIXED
// =====================
router.get('/', protect, async (req, res) => {
  try {
    const { status, priority } = req.query;
    
    // ✅ FIXED: Use helper function
    const userId = getUserId(req.user);
    console.log('🔍 Fetching follow-ups for userId:', userId);
    
    const query = { userId: userId };
    
    // Filter by status if provided
    if (status) {
      query.status = status;
    }
    
    // Filter by priority if provided
    if (priority) {
      query.priority = priority;
    }

    const followUps = await FollowUp.find(query)
      .sort({ followUpDate: 1 }) // Sort by date, earliest first
      .lean();

    // Separate into due and upcoming
    const now = new Date();
    const due = followUps.filter(f => new Date(f.followUpDate) <= now && f.status === 'pending');
    const upcoming = followUps.filter(f => new Date(f.followUpDate) > now && f.status === 'pending');
    const completed = followUps.filter(f => f.status === 'completed');

    console.log(`✅ Found ${followUps.length} follow-ups`);

    res.json({
      success: true,
      followUps: {
        all: followUps,
        due,
        upcoming,
        completed
      },
      counts: {
        total: followUps.length,
        due: due.length,
        upcoming: upcoming.length,
        completed: completed.length
      }
    });

  } catch (error) {
    console.error('❌ Get follow-ups error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch follow-ups',
      details: error.message
    });
  }
});
router.get('/notifications/due', protect, async (req, res) => {
  try {
    const now = new Date();
    const userId = getUserId(req.user);
    
    const dueFollowUps = await FollowUp.find({
      userId: userId,
      status: 'pending',
      followUpDate: { $lte: now },
      notified: false
    })
    .sort({ priority: -1, followUpDate: 1 })
    .limit(10);

    // Mark as notified
    if (dueFollowUps.length > 0) {
      await FollowUp.updateMany(
        {
          _id: { $in: dueFollowUps.map(f => f._id) }
        },
        {
          notified: true
        }
      );
    }

    res.json({
      success: true,
      dueFollowUps,
      count: dueFollowUps.length
    });

  } catch (error) {
    console.error('❌ Get due follow-ups error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch due follow-ups',
      details: error.message
    });
  }
});

// =====================
// GET single follow-up - FIXED
// =====================
router.get('/:id', protect, async (req, res) => {
  try {
    const userId = getUserId(req.user);
    
    const followUp = await FollowUp.findOne({
      _id: req.params.id,
      userId: userId
    });

    if (!followUp) {
      return res.status(404).json({
        success: false,
        error: 'Follow-up not found'
      });
    }

    res.json({
      success: true,
      followUp
    });

  } catch (error) {
    console.error('❌ Get follow-up error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch follow-up',
      details: error.message
    });
  }
});

// =====================
// UPDATE follow-up - FIXED
// =====================
router.put('/:id', protect, async (req, res) => {
  try {
    const { followUpDate, notes, priority, status } = req.body;
    const userId = getUserId(req.user);

    const followUp = await FollowUp.findOne({
      _id: req.params.id,
      userId: userId
    });

    if (!followUp) {
      return res.status(404).json({
        success: false,
        error: 'Follow-up not found'
      });
    }

    // Update fields
    if (followUpDate) followUp.followUpDate = new Date(followUpDate);
    if (notes !== undefined) followUp.notes = notes;
    if (priority) followUp.priority = priority;
    if (status) followUp.status = status;

    await followUp.save();

    console.log(`✅ Follow-up ${req.params.id} updated`);

    res.json({
      success: true,
      followUp,
      message: 'Follow-up updated successfully'
    });

  } catch (error) {
    console.error('❌ Update follow-up error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update follow-up',
      details: error.message
    });
  }
});

// =====================
// MARK as completed - FIXED
// =====================
router.patch('/:id/complete', protect, async (req, res) => {
  try {
    const userId = getUserId(req.user);
    
    const followUp = await FollowUp.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: userId
      },
      {
        status: 'completed'
      },
      { new: true }
    );

    if (!followUp) {
      return res.status(404).json({
        success: false,
        error: 'Follow-up not found'
      });
    }

    console.log(`✅ Follow-up ${req.params.id} marked as completed`);

    res.json({
      success: true,
      followUp,
      message: 'Follow-up marked as completed'
    });

  } catch (error) {
    console.error('❌ Complete follow-up error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete follow-up',
      details: error.message
    });
  }
});

// =====================
// DELETE follow-up - FIXED
// =====================
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = getUserId(req.user);
    
    const followUp = await FollowUp.findOneAndDelete({
      _id: req.params.id,
      userId: userId
    });

    if (!followUp) {
      return res.status(404).json({
        success: false,
        error: 'Follow-up not found'
      });
    }

    console.log(`✅ Follow-up ${req.params.id} deleted`);

    res.json({
      success: true,
      message: 'Follow-up deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete follow-up error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete follow-up',
      details: error.message
    });
  }
});



module.exports = router;