const User = require('../models/User');
const path = require('path');
const fs = require('fs').promises;

// @desc    Get user profile
// @route   GET /api/user/profile
// @access  Private
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -refreshToken -googleTokens');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        bio: user.bio,
        company: user.company,
        jobTitle: user.jobTitle,
        location: user.location,
        phone: user.phone,
        website: user.website,
        profilePicture: user.profilePicture,
        subscriptionTier: user.subscriptionTier,
        subscriptionStatus: user.subscriptionStatus,
        createdAt: user.createdAt,
        emailQuotaUsed: user.emailQuotaUsed,
        emailQuotaLimit: user.emailQuotaLimit,
        freeCleanupCount: user.freeCleanupCount,
        totalCleanupsUsed: user.totalCleanupsUsed,
        trialEndDate: user.trialEndDate,
        currentPeriodEnd: user.currentPeriodEnd
      }
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching profile',
      error: error.message 
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/user/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, bio, company, jobTitle, location, phone, website } = req.body;

    // Validation
    if (name && name.trim().length < 2) {
      return res.status(400).json({ 
        success: false,
        message: 'Name must be at least 2 characters' 
      });
    }

    if (bio && bio.length > 500) {
      return res.status(400).json({ 
        success: false,
        message: 'Bio must be less than 500 characters' 
      });
    }

    if (phone && !/^[\d\s\+\-\(\)]+$/.test(phone)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid phone number format' 
      });
    }

    if (website && !/^https?:\/\/.+/.test(website)) {
      return res.status(400).json({ 
        success: false,
        message: 'Website must be a valid URL (include http:// or https://)' 
      });
    }

    // Update user
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        name: name?.trim(),
        bio: bio?.trim(),
        company: company?.trim(),
        jobTitle: jobTitle?.trim(),
        location: location?.trim(),
        phone: phone?.trim(),
        website: website?.trim()
      },
      { new: true, runValidators: true }
    ).select('-password -refreshToken -googleTokens');

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        bio: user.bio,
        company: user.company,
        jobTitle: user.jobTitle,
        location: user.location,
        phone: user.phone,
        website: user.website,
        profilePicture: user.profilePicture,
        subscriptionTier: user.subscriptionTier,
        subscriptionStatus: user.subscriptionStatus,
        createdAt: user.createdAt,
        emailQuotaUsed: user.emailQuotaUsed,
        emailQuotaLimit: user.emailQuotaLimit,
        freeCleanupCount: user.freeCleanupCount,
        totalCleanupsUsed: user.totalCleanupsUsed
      }
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error updating profile',
      error: error.message 
    });
  }
};

// @desc    Upload profile picture
// @route   POST /api/user/profile-picture
// @access  Private
exports.uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No file uploaded' 
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      // Delete uploaded file if user not found
      await fs.unlink(req.file.path);
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Delete old profile picture if exists
    if (user.profilePicture) {
      try {
        const oldPhotoPath = path.join(__dirname, '..', user.profilePicture);
        await fs.unlink(oldPhotoPath);
      } catch (err) {
        console.error('Error deleting old photo:', err);
        // Continue even if old photo deletion fails
      }
    }

    // Update user with new profile picture path
    const profilePictureUrl = `/uploads/profiles/${req.file.filename}`;
    user.profilePicture = profilePictureUrl;
    await user.save();

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      profilePictureUrl
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (err) {
        console.error('Error deleting uploaded file:', err);
      }
    }

    console.error('Error uploading profile picture:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error uploading profile picture',
      error: error.message 
    });
  }
};

// @desc    Delete profile picture
// @route   DELETE /api/user/profile-picture
// @access  Private
exports.deleteProfilePicture = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    if (!user.profilePicture) {
      return res.status(400).json({ 
        success: false,
        message: 'No profile picture to delete' 
      });
    }

    // Delete photo file
    try {
      const photoPath = path.join(__dirname, '..', user.profilePicture);
      await fs.unlink(photoPath);
    } catch (err) {
      console.error('Error deleting photo file:', err);
      // Continue even if file deletion fails
    }

    // Remove from database
    user.profilePicture = null;
    await user.save();

    res.json({
      success: true,
      message: 'Profile picture deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting profile picture:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error deleting profile picture',
      error: error.message 
    });
  }
};