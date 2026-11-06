const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const { protect } = require('../middleware/auth');
const {
  register,
  verifyEmail,
  resendVerification,
  login,
  getUser,
  updateProfile,
  changePassword,
  logout,
  forgotPassword,
  resetPassword,
  oauthCallback
} = require('../controllers/authController');

// ✅ Authentication
router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/login', login);
router.post('/logout', protect, logout);

// ✅ User Profile
router.get('/user', protect, getUser);
router.put('/profile', protect, updateProfile);

// ✅ Password Management
router.post('/change-password', protect, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// ✅ Google OAuth
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  oauthCallback
);

// ✅ Facebook OAuth
router.get('/facebook',
  passport.authenticate('facebook', { scope: ['email'] })
);
router.get('/facebook/callback',
  passport.authenticate('facebook', { session: false, failureRedirect: '/login' }),
  oauthCallback
);

module.exports = router;