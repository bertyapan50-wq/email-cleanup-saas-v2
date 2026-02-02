const planningService = require('../services/planningService');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Get PRE-COMPILED models from mongoose
const Task = mongoose.model('Task');
const UserWorkPattern = mongoose.model('UserWorkPattern');

const planningController = {
  /**
   * Generate daily plan
   */
  generatePlan: async (req, res) => {
    try {
      const userId = req.user._id;
      const { date } = req.body;
      
      const result = await planningService.generateDailyPlan(
        userId,
        date ? new Date(date) : new Date()
      );
      
      res.json(result);
    } catch (error) {
      logger.error('Generate plan error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate plan',
        error: error.message
      });
    }
  },

  /**
   * Get today's schedule
   */
  getTodaySchedule: async (req, res) => {
    try {
      const userId = req.user._id;
      const result = await planningService.getTodaySchedule(userId);
      
      res.json(result);
    } catch (error) {
      logger.error('Get schedule error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get schedule',
        error: error.message
      });
    }
  },

  /**
   * Create new task
   */
  createTask: async (req, res) => {
    try {
      const userId = req.user._id;
      const {
        title,
        description,
        priority,
        estimatedDuration,
        deadline,
        category,
        tags
      } = req.body;
      
      if (!title) {
        return res.status(400).json({
          success: false,
          message: 'Title is required'
        });
      }
      
      const task = await Task.create({
        userId,
        title,
        description,
        priority: priority || 'medium',
        estimatedDuration: estimatedDuration || 60,
        deadline: deadline ? new Date(deadline) : null,
        category: category || 'General',
        tags: tags || []
      });
      
      logger.info(`✅ Created task: ${title}`);
      
      res.status(201).json({
        success: true,
        task
      });
      
    } catch (error) {
      logger.error('Create task error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create task',
        error: error.message
      });
    }
  },

  /**
   * Get all tasks
   */
  getTasks: async (req, res) => {
    try {
      const userId = req.user._id;
      const { status, category } = req.query;
      
      const query = { userId };
      if (status) query.status = status;
      if (category) query.category = category;
      
      const tasks = await Task.find(query).sort({ createdAt: -1 });
      
      res.json({
        success: true,
        tasks
      });
      
    } catch (error) {
      logger.error('Get tasks error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get tasks',
        error: error.message
      });
    }
  },

  /**
   * Update task
   */
  updateTask: async (req, res) => {
    try {
      const userId = req.user._id;
      const { taskId } = req.params;
      const updates = req.body;
      
      const task = await Task.findOne({ _id: taskId, userId });
      if (!task) {
        return res.status(404).json({
          success: false,
          message: 'Task not found'
        });
      }
      
      Object.assign(task, updates);
      await task.save();
      
      res.json({
        success: true,
        task
      });
      
    } catch (error) {
      logger.error('Update task error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update task',
        error: error.message
      });
    }
  },

  /**
   * Delete task
   */
  deleteTask: async (req, res) => {
    try {
      const userId = req.user._id;
      const { taskId } = req.params;
      
      const task = await Task.findOneAndDelete({ _id: taskId, userId });
      if (!task) {
        return res.status(404).json({
          success: false,
          message: 'Task not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Task deleted'
      });
      
    } catch (error) {
      logger.error('Delete task error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete task',
        error: error.message
      });
    }
  },

  /**
   * Reschedule task
   */
  rescheduleTask: async (req, res) => {
    try {
      const userId = req.user._id;
      const { taskId } = req.params;
      const { newTime } = req.body;
      
      if (!newTime) {
        return res.status(400).json({
          success: false,
          message: 'New time is required'
        });
      }
      
      const result = await planningService.rescheduleTask(taskId, newTime, userId);
      
      res.json(result);
      
    } catch (error) {
      logger.error('Reschedule error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reschedule task',
        error: error.message
      });
    }
  },

  /**
   * Complete task
   */
  completeTask: async (req, res) => {
    try {
      const userId = req.user._id;
      const { taskId } = req.params;
      const { actualDuration } = req.body;
      
      const result = await planningService.completeTask(taskId, actualDuration, userId);
      
      res.json(result);
      
    } catch (error) {
      logger.error('Complete task error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete task',
        error: error.message
      });
    }
  },

  /**
   * Get work pattern settings
   */
  getWorkPattern: async (req, res) => {
    try {
      const userId = req.user._id;
      let workPattern = await UserWorkPattern.findOne({ userId });
      
      if (!workPattern) {
        workPattern = await planningService.createDefaultWorkPattern(userId);
      }
      
      res.json({
        success: true,
        workPattern
      });
      
    } catch (error) {
      logger.error('Get work pattern error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get work pattern',
        error: error.message
      });
    }
  },

  /**
   * Update work pattern settings
   */
  updateWorkPattern: async (req, res) => {
    try {
      const userId = req.user._id;
      const updates = req.body;
      
      let workPattern = await UserWorkPattern.findOne({ userId });
      if (!workPattern) {
        workPattern = await planningService.createDefaultWorkPattern(userId);
      }
      
      // Update fields
      if (updates.workHours) workPattern.workHours = updates.workHours;
      if (updates.breaks) workPattern.breaks = updates.breaks;
      if (updates.peakHours) workPattern.peakHours = updates.peakHours;
      if (updates.preferences) {
        workPattern.preferences = { ...workPattern.preferences, ...updates.preferences };
      }
      
      await workPattern.save();
      
      res.json({
        success: true,
        workPattern
      });
      
    } catch (error) {
      logger.error('Update work pattern error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update work pattern',
        error: error.message
      });
    }
  }
};

module.exports = planningController;