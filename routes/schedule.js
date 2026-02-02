const express = require('express');
const router = express.Router();
const Schedule = require('../models/Schedule');
const ScheduleLog = require('../models/ScheduleLog');
const { isAuthenticated } = require('../middleware/auth');

// Helper function to calculate next run
function calculateNextRun(type, time, dayOfWeek, dayOfMonth, timezone = 'Asia/Manila') {
  const [hours, minutes] = time.split(':').map(Number);
  const now = new Date();
  let next = new Date();
  
  next.setHours(hours, minutes, 0, 0);

  if (type === 'daily') {
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (type === 'weekly') {
    const currentDay = next.getDay();
    const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
    next.setDate(next.getDate() + daysUntilTarget);
    
    if (next <= now) {
      next.setDate(next.getDate() + 7);
    }
  } else if (type === 'monthly') {
    next.setDate(dayOfMonth);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }

  return next;
}

// Get user's active schedule
router.get('/get', isAuthenticated, async (req, res) => {
  try {
    const schedule = await Schedule.findOne({ 
      userId: req.user.id, 
      isActive: true 
    }).sort({ createdAt: -1 });
    
    res.json({ 
      schedule: schedule ? {
        is_active: schedule.isActive,
        schedule_type: schedule.scheduleType,
        time: schedule.time,
        day_of_week: schedule.dayOfWeek,
        day_of_month: schedule.dayOfMonth,
        confidence_level: schedule.confidenceLevel,
        categories: schedule.categories,
        action: schedule.action,
        next_run: schedule.nextRun,
        total_runs: schedule.totalRuns,
        total_emails_processed: schedule.totalEmailsProcessed
      } : null
    });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// Save/Update schedule
router.post('/save', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      enabled,
      type,
      time,
      dayOfWeek,
      dayOfMonth,
      confidenceLevel,
      categories,
      action
    } = req.body;

    if (!type || !time) {
      return res.status(400).json({ error: 'Schedule type and time are required' });
    }

    // Deactivate existing schedules
    await Schedule.updateMany(
      { userId, isActive: true },
      { isActive: false }
    );

    if (enabled) {
      const nextRun = calculateNextRun(type, time, dayOfWeek, dayOfMonth);
      
      const schedule = await Schedule.create({
        userId,
        scheduleType: type,
        time,
        dayOfWeek: dayOfWeek || null,
        dayOfMonth: dayOfMonth || null,
        confidenceLevel: confidenceLevel || 'high',
        categories: categories || [],
        action: action || 'archive',
        timezone: 'Asia/Manila',
        nextRun,
        isActive: true
      });

      res.json({ 
        success: true, 
        schedule,
        message: `Schedule created! Next cleanup: ${nextRun.toLocaleString()}`
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Auto-cleanup disabled'
      });
    }
  } catch (error) {
    console.error('Error saving schedule:', error);
    res.status(500).json({ error: 'Failed to save schedule' });
  }
});

// Get execution history
router.get('/history', isAuthenticated, async (req, res) => {
  try {
    const history = await ScheduleLog.find({ userId: req.user.id })
      .sort({ executedAt: -1 })
      .limit(10);
    
    res.json({ 
      history: history.map(log => ({
        id: log._id,
        emails_processed: log.emailsProcessed,
        action_taken: log.actionTaken,
        status: log.status,
        executed_at: log.executedAt
      }))
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Delete schedule
router.delete('/delete', isAuthenticated, async (req, res) => {
  try {
    await Schedule.updateMany(
      { userId: req.user.id },
      { isActive: false }
    );
    res.json({ success: true, message: 'Schedule deleted' });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

module.exports = router;
module.exports.calculateNextRun = calculateNextRun;
module.exports.Schedule = Schedule;
module.exports.ScheduleLog = ScheduleLog;