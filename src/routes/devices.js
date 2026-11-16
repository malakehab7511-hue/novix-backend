const express = require('express');
const router = express.Router();
const { sendDeviceCommand, getDeviceState } = require('../controllers/deviceController');
const { protect, optionalAuth } = require('../middleware/auth');

// التحكم محتاج تسجيل دخول (JWT)، وقراءة الحالة للزوار
router.post('/:id/command', protect, sendDeviceCommand);
router.get('/:id/state', optionalAuth, getDeviceState);

module.exports = router;
