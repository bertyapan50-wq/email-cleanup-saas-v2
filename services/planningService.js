const mongoose = require('mongoose');
const logger = require('../utils/logger');
const smartSchedulingService = require('./smartSchedulingService'); // ✅ NEW

// Get models using mongoose.model() to avoid circular dependency
const getTask = () => mongoose.model('Task');
const getUserWorkPattern = () => mongoose.model('UserWorkPattern');
const getUserPreferences = () => mongoose.model('UserPreferences');

class PlanningService {
  constructor() {
    this.defaultWorkHours = {
      start: '09:00',
      end: '17:00'
    };
    
    this.defaultBreaks = [
      { name: 'Lunch', start: '12:00', end: '13:00' }
    ];
  }

 async generateDailyPlan(userId, date = new Date()) {
  try {
    const Task = getTask();
    const UserWorkPattern = getUserWorkPattern();
    const UserPreferences = getUserPreferences();
    
    logger.info(`📅 Generating daily plan for user ${userId}`);
    
    // 1. Get user's pending tasks (✅ FIXED: only pending)
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const pendingTasks = await Task.find({
      userId,
      status: 'pending',
      $or: [
        { deadline: { $lte: endOfDay } },
        { deadline: null }
      ]
    }).sort({ priority: -1, deadline: 1 });
    
    if (pendingTasks.length === 0) {
      return {
        success: true,
        message: 'No tasks to schedule',
        schedule: [],
        reasoning: { summary: 'No pending tasks to schedule', insights: [] }
      };
    }
    
    // 2. Get user's work pattern
    let workPattern = await UserWorkPattern.findOne({ userId });
    if (!workPattern) {
      workPattern = await this.createDefaultWorkPattern(userId);
    }
    
    // 3. Get user preferences
    const preferences = await UserPreferences.findOne({ userId });
    
    // 4. Get existing scheduled tasks for conflict detection
    const existingSchedule = await Task.find({
      userId,
      scheduledTime: { $gte: startOfDay, $lte: endOfDay },
      status: 'scheduled'
    });
    
    logger.info(`📊 Found ${pendingTasks.length} pending tasks, ${existingSchedule.length} already scheduled`);
    
    // ✅ NEW: 5. Use Smart AI-like Scheduler
    let scheduleResult;
    try {
      logger.info('🧠 Using Smart Intelligent Scheduler...');
      
      scheduleResult = await smartSchedulingService.generateIntelligentPlan(
        pendingTasks,
        workPattern,
        workPattern, // Pass work pattern as user history for now
        date
      );
      
      logger.info('✅ Smart scheduling completed successfully');
      
    } catch (smartError) {
      logger.error('Smart scheduler failed, falling back to basic algorithm:', smartError);
      
      // Fallback to original algorithm
      const timeSlots = this.generateTimeSlots(
        date,
        workPattern.workHours,
        workPattern.breaks,
        workPattern.preferences.bufferTime
      );
      
      // Mark occupied slots
      existingSchedule.forEach(task => {
        const taskStart = new Date(task.scheduledTime);
        const taskDuration = task.estimatedDuration || 60;
        const taskEnd = new Date(taskStart.getTime() + taskDuration * 60000);
        
        timeSlots.forEach(slot => {
          if (slot.start < taskEnd && slot.end > taskStart) {
            slot.available = false;
          }
        });
      });
      
      const schedule = this.scheduleTasks(
        pendingTasks,
        timeSlots,
        workPattern,
        preferences
      );
      
      scheduleResult = {
        success: true,
        schedule,
        reasoning: { 
          summary: 'Scheduled using basic algorithm', 
          insights: ['Tasks scheduled by priority and availability'] 
        }
      };
    }
    
    // 6. Save scheduled times to database
    await this.saveSchedule(scheduleResult.schedule);
    
    logger.info(`✅ Generated plan with ${scheduleResult.schedule.length} tasks`);
    
    return {
      success: true,
      schedule: scheduleResult.schedule,
      reasoning: scheduleResult.reasoning,
      aiGenerated: true, // ✅ Mark as AI-generated
      stats: {
        totalTasks: pendingTasks.length,
        scheduled: scheduleResult.schedule.length,
        unscheduled: pendingTasks.length - scheduleResult.schedule.length,
        existingTasks: existingSchedule.length
      }
    };
    
  } catch (error) {
    logger.error('Planning service error:', error);
    throw error;
  }
}
  /**
 * Generate available time slots for the day
 */
generateTimeSlots(date, workHours, breaks, bufferTime = 15) {
  const slots = [];
  const [startHour, startMin] = workHours.start.split(':').map(Number);
  const [endHour, endMin] = workHours.end.split(':').map(Number);
  
  let currentTime = new Date(date);
  currentTime.setHours(startHour, startMin, 0, 0);
  
  const endTime = new Date(date);
  endTime.setHours(endHour, endMin, 0, 0);
  
  while (currentTime < endTime) {
    const slotStart = new Date(currentTime);
    const slotEnd = new Date(currentTime.getTime() + 30 * 60000); // 30-min slots
    
    // Check if slot overlaps with breaks
    const isBreak = breaks.some(br => {
      const [brStartH, brStartM] = br.start.split(':').map(Number);
      const [brEndH, brEndM] = br.end.split(':').map(Number);
      
      const breakStart = new Date(date);
      breakStart.setHours(brStartH, brStartM, 0, 0);
      
      const breakEnd = new Date(date);
      breakEnd.setHours(brEndH, brEndM, 0, 0);
      
      return slotStart < breakEnd && slotEnd > breakStart;
    });
    
    if (!isBreak) {
      slots.push({
        start: new Date(slotStart),
        end: new Date(slotEnd),
        available: true
      });
    }
    
    // ✅ FIXED: Move by 30 min only, no extra buffer here
    currentTime = new Date(currentTime.getTime() + 30 * 60000);
  }
  
  return slots;
}

  /**
   * Schedule tasks into available time slots
   */
  scheduleTasks(tasks, timeSlots, workPattern, preferences) {
    const schedule = [];
    let slotIndex = 0;
    
    // Sort tasks by priority and deadline
    const sortedTasks = [...tasks].sort((a, b) => {
      // Priority: high > medium > low
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      
      // Then by deadline
      if (a.deadline && b.deadline) {
        return new Date(a.deadline) - new Date(b.deadline);
      }
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      
      return 0;
    });
    
    for (const task of sortedTasks) {
      const duration = task.estimatedDuration || 60;
      const slotsNeeded = Math.ceil(duration / 30); // Each slot is 30 min
      
      // Find consecutive available slots
      let foundSlots = [];
      for (let i = slotIndex; i < timeSlots.length; i++) {
        if (timeSlots[i].available) {
          foundSlots.push(i);
          if (foundSlots.length === slotsNeeded) {
            break;
          }
        } else {
          foundSlots = [];
        }
      }
      
      if (foundSlots.length === slotsNeeded) {
        // Schedule task
        const startSlot = timeSlots[foundSlots[0]];
        const endSlot = timeSlots[foundSlots[foundSlots.length - 1]];
        
        schedule.push({
          task: task,
          scheduledTime: startSlot.start,
          endTime: endSlot.end,
          duration: duration
        });
        
        // Mark slots as used
        foundSlots.forEach(idx => {
          timeSlots[idx].available = false;
        });
        
        slotIndex = foundSlots[foundSlots.length - 1] + 1;
      }
      
      // Stop if no more slots available
      if (slotIndex >= timeSlots.length) {
        break;
      }
    }
    
    return schedule;
  }

  /**
 * Save scheduled tasks
 */
async saveSchedule(schedule) {
  const Task = getTask();
 logger.info('🔥 NEW CODE DEPLOYED - Using findByIdAndUpdate');
  
  for (const item of schedule) {
    // ✅ Use findByIdAndUpdate instead of fetching then saving
    await Task.findByIdAndUpdate(
      item.task._id,
      {
        scheduledTime: item.scheduledTime,
        status: 'scheduled'
      },
      { new: true }
    );
  }
  
  logger.info(`✅ Saved ${schedule.length} tasks to database`);
}

  /**
   * Reschedule a single task
   */
  async rescheduleTask(taskId, newTime, userId) {
    try {
      const Task = getTask();
      
      const task = await Task.findOne({ _id: taskId, userId });
      if (!task) {
        throw new Error('Task not found');
      }
      
      // Update task time
      task.scheduledTime = new Date(newTime);
      task.status = 'scheduled';
      await task.save();
      
      logger.info(`✅ Rescheduled task ${taskId} to ${newTime}`);
      
      return {
        success: true,
        task
      };
      
    } catch (error) {
      logger.error('Reschedule error:', error);
      throw error;
    }
  }

  /**
   * Mark task complete and learn from it
   */
  async completeTask(taskId, actualDuration, userId) {
    try {
      const Task = getTask();
      const UserWorkPattern = getUserWorkPattern();
      
      const task = await Task.findOne({ _id: taskId, userId });
      if (!task) {
        throw new Error('Task not found');
      }
      
      // Mark complete
      await task.markComplete(actualDuration);
      
      // Update work pattern
      let workPattern = await UserWorkPattern.findOne({ userId });
      if (!workPattern) {
        workPattern = await this.createDefaultWorkPattern(userId);
      }
      
      await workPattern.recordCompletion(task);
      
      logger.info(`✅ Task ${taskId} completed. Learning from completion.`);
      
      return {
        success: true,
        task
      };
      
    } catch (error) {
      logger.error('Complete task error:', error);
      throw error;
    }
  }

  /**
   * Create default work pattern for new user
   */
  async createDefaultWorkPattern(userId) {
    const UserWorkPattern = getUserWorkPattern();
    
    return await UserWorkPattern.create({
      userId,
      workHours: this.defaultWorkHours,
      breaks: this.defaultBreaks,
      peakHours: [9, 10, 14, 15],
      preferences: {
        bufferTime: 15,
        maxTasksPerDay: 8,
        preferMorning: true,
        batchSimilarTasks: true
      }
    });
  }

  /**
   * Get today's schedule
   */
  async getTodaySchedule(userId) {
    try {
      const Task = getTask();
      
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      
      const tasks = await Task.find({
        userId,
        scheduledTime: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['scheduled', 'in-progress', 'completed'] }
      }).sort({ scheduledTime: 1 });
      
      return {
        success: true,
        tasks,
        date: new Date()
      };
      
    } catch (error) {
      logger.error('Get schedule error:', error);
      throw error;
    }
  }
}

module.exports = new PlanningService(); 
