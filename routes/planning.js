const express = require('express');
const router = express.Router();
const planningController = require('../controllers/planningController');
const auth = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscription'); // Add this

// All routes require authentication AND premium
router.use(auth);
router.use(requirePremium); // Add this - blocks all non-premium users

// Planning
router.post('/generate-plan', planningController.generatePlan);
router.get('/today', planningController.getTodaySchedule);

// Tasks CRUD
router.post('/tasks', planningController.createTask);
router.get('/tasks', planningController.getTasks);
router.put('/tasks/:taskId', planningController.updateTask);
router.delete('/tasks/:taskId', planningController.deleteTask);

// Task Actions
router.post('/tasks/:taskId/reschedule', planningController.rescheduleTask);
router.post('/tasks/:taskId/complete', planningController.completeTask);

// Work Pattern Settings
router.get('/work-pattern', planningController.getWorkPattern);
router.put('/work-pattern', planningController.updateWorkPattern);

module.exports = router;