const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const Category = require('../models/Category');
const logger = require('../utils/logger');

// ==================== GET CATEGORY STATS ====================
// ✅ MOVED TO TOP - specific routes must come BEFORE parameterized routes
router.get('/stats', isAuthenticated, async (req, res) => {
  try {
    const categories = await Category.find({ userId: req.user._id });
    
    const stats = {
      total: categories.length,
      totalEmails: categories.reduce((sum, cat) => sum + (cat.emailCount || 0), 0),
      categories: categories.map(cat => ({
        id: cat._id,
        name: cat.name,
        emailCount: cat.emailCount || 0
      }))
    };

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Error fetching category stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category stats'
    });
  }
});

// ==================== GET ALL CATEGORIES ====================
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const categories = await Category.find({ userId: req.user._id }).sort({ createdAt: -1 });

    logger.info(`User ${req.user.email} fetched ${categories.length} categories`);

    res.json({
      success: true,
      categories: categories.map(cat => ({
        id: cat._id,
        name: cat.name,
        color: cat.color,
        icon: cat.icon,
        emailCount: cat.emailCount || 0
      }))
    });
  } catch (error) {
    logger.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
});

// ==================== CREATE CATEGORY ====================
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { name, color, icon } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Check if category already exists
    const existingCategory = await Category.findOne({
      userId: req.user._id,
      name: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists'
      });
    }

    const category = await Category.create({
      userId: req.user._id,
      name: name.trim(),
      color: color || '#6366f1',
      icon: icon || 'folder',
      emailCount: 0
    });

    logger.info(`User ${req.user.email} created category: ${category.name}`);

    res.json({
      success: true,
      message: 'Category created successfully',
      category: {
        id: category._id,
        name: category.name,
        color: category.color,
        icon: category.icon,
        emailCount: category.emailCount
      }
    });
  } catch (error) {
    logger.error('Error creating category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create category'
    });
  }
});

// ==================== UPDATE CATEGORY ====================
router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, icon } = req.body;

    const category = await Category.findOne({
      _id: id,
      userId: req.user._id
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Update fields
    if (name && name.trim()) category.name = name.trim();
    if (color) category.color = color;
    if (icon) category.icon = icon;

    await category.save();

    logger.info(`User ${req.user.email} updated category: ${category.name}`);

    res.json({
      success: true,
      message: 'Category updated successfully',
      category: {
        id: category._id,
        name: category.name,
        color: category.color,
        icon: category.icon,
        emailCount: category.emailCount
      }
    });
  } catch (error) {
    logger.error('Error updating category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update category'
    });
  }
});

// ==================== DELETE CATEGORY ====================
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findOne({
      _id: id,
      userId: req.user._id
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    await category.deleteOne();

    logger.info(`User ${req.user.email} deleted category: ${category.name}`);

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete category'
    });
  }
});

module.exports = router;