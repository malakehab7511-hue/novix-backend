const express = require('express');
const router = express.Router();
const {
  getAllAlerts,
  getActiveAlerts,
  resolveAlert,
  resolveAllAlerts,
} = require('../controllers/alertController');
const { protect, optionalAuth } = require('../middleware/auth');

// القراءة للزوار، والأكشن (حل التنبيهات) محتاج تسجيل دخول
router.get('/all', optionalAuth, getAllAlerts);
router.get('/active', optionalAuth, getActiveAlerts);
router.patch('/resolve-all', protect, resolveAllAlerts);
router.patch('/resolve/:id', protect, resolveAlert);

module.exports = router;
