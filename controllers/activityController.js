const Activity = require('../models/Activity');
const logger = require('../utils/logger');

// Get user's activity logs
exports.getActivityLogs = async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      page = 1, 
      limit = 50, 
      action, 
      startDate, 
      endDate 
    } = req.query;

    // Build query
    const query = { userId };

    // Filter by action type
    if (action) {
      query.action = action;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Get activities
    const activities = await Activity.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    // Get total count
    const total = await Activity.countDocuments(query);

    // Calculate stats
    const stats = await Activity.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { 
          _id: '$action', 
          count: { $sum: 1 } 
        }
      }
    ]);

    res.json({
      success: true,
      activities,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      },
      stats: stats.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    });

  } catch (error) {
    logger.error('Error fetching activity logs:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch activity logs' 
    });
  }
};

// ✅ NEW: API endpoint to log activity
exports.logActivityAPI = async (req, res) => {
  try {
    const { type, description, metadata } = req.body;
    const userId = req.user._id;
    
    const activityData = {
      userId,
      action: type || 'general_action',
      description: description || 'Activity logged',
      details: metadata || {},
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('user-agent'),
      timestamp: new Date()
    };

    const activity = await Activity.create(activityData);
    
    logger.info(`✅ Activity logged: ${type} for user ${userId}`);
    
    res.json({
      success: true,
      activity
    });
  } catch (error) {
    logger.error('❌ Log activity error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to log activity' 
    });
  }
};

// Log an activity (internal use - keep original for backward compatibility)
exports.logActivity = async (userId, action, description, details = {}, req = null) => {
  try {
    const activityData = {
      userId,
      action,
      description,
      details
    };

    // Add request info if available
    if (req) {
      activityData.ipAddress = req.ip || req.connection.remoteAddress;
      activityData.userAgent = req.get('user-agent');
    }

    const activity = await Activity.create(activityData);
    logger.info(`Activity logged: ${action} for user ${userId}`);
    
    return activity;
  } catch (error) {
    logger.error('Error logging activity:', error);
    // Don't throw error - logging should not break the main flow
    return null;
  }
};

// Get activity stats
exports.getActivityStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const stats = await Activity.aggregate([
      {
        $match: {
          userId: req.user._id,
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            action: '$action'
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.date': 1 }
      }
    ]);

    res.json({
      success: true,
      stats,
      period: { days: parseInt(days), startDate }
    });

  } catch (error) {
    logger.error('Error fetching activity stats:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch activity stats' 
    });
  }
};

// Delete old activities (for user)
exports.clearActivityLogs = async (req, res) => {
  try {
    const userId = req.user._id;
    const { olderThan } = req.body; // Days

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (olderThan || 90));

    const result = await Activity.deleteMany({
      userId,
      timestamp: { $lt: cutoffDate }
    });

    // Log this action
    await exports.logActivity(
      userId,
      'activity_logs_cleared',
      `Cleared ${result.deletedCount} activity logs older than ${olderThan || 90} days`,
      { deletedCount: result.deletedCount, cutoffDate },
      req
    );

    res.json({
      success: true,
      message: `Cleared ${result.deletedCount} activity logs`,
      deletedCount: result.deletedCount
    });

  } catch (error) {
    logger.error('Error clearing activity logs:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to clear activity logs' 
    });
  }
};

module.exports = exports;