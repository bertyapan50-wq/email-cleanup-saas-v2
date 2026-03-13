const User = require('../models/User');
const jwt = require('jsonwebtoken');

/**
 * 🔐 MAIN AUTH (AUTO)
 * - Uses Passport session if available
 * - Falls back to JWT if no session
 * - ✅ LOADS googleTokens for Gmail API access
 */
const auth = async (req, res, next) => {
  try {
    // ===== 1️⃣ Passport Session Auth =====
    if (req.isAuthenticated?.()) {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'No user found in session'
        });
      }

      // ✅ Reload user with googleTokens
      const fullUser = await User.findById(req.user._id || req.user.id);
      if (!fullUser) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      req.user = fullUser;
      console.log('✅ Auth via SESSION:', req.user.email);
      console.log('🔐 Has googleTokens:', !!req.user.googleTokens?.access_token);
      return next();
    }

    // ===== 2️⃣ JWT Fallback =====
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      req.user = user;
      console.log('✅ Auth via JWT:', user.email);
      console.log('🔐 Has googleTokens:', !!user.googleTokens?.access_token);
      return next();
    }

    // ===== ❌ No Auth =====
    return res.status(401).json({
      success: false,
      message: 'Not authorized - Please log in'
    });

  } catch (error) {
    console.error('❌ Auth error:', error);
    return res.status(401).json({
      success: false,
      message: 'Authentication failed',
      error: error.message
    });
  }
};

/**
 * 🔐 Session-only (optional)
 */
const protect = auth;

/**
 * 🔐 JWT-only (optional)
 */
const protectJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized - No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    req.user = user;
    console.log('✅ JWT-only auth:', user.email);
    console.log('🔐 Has googleTokens:', !!user.googleTokens?.access_token);
    next();

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
};

/**
 * ✅ NEW: isAuthenticated alias (for profile routes)
 * Same as auth, just different name for compatibility
 */
const isAuthenticated = auth;

/**
 * ✅ Premium check middleware
 */
const requirePremium = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const premiumTiers = ['premium', 'pro', 'enterprise', 'trial'];
    const userTier = req.user.subscriptionTier?.toLowerCase();
    const userStatus = req.user.subscriptionStatus?.toLowerCase();

    if (premiumTiers.includes(userTier) || userStatus === 'active' || userStatus === 'trialing') {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Premium subscription required',
      upgradeRequired: true
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

/**
 * ✅ EXPORTS (BUG-PROOF)
 */
module.exports = auth;
module.exports.auth = auth;
module.exports.protect = protect;
module.exports.protectJWT = protectJWT;
module.exports.isAuthenticated = isAuthenticated;
module.exports.requirePremium = requirePremium; // ✅ ADDED