const express = require('express');
const router = express.Router();
const planningController = require('../controllers/planningController');
const auth = require('../middleware/auth');
// const { requirePremium } = require('../middleware/subscription'); // ✅ REMOVED

// All routes require authentication only (no premium check)
router.use(auth);
// router.use(requirePremium); // ✅ REMOVED - Auto Planner is now FREE!

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