const express = require('express');
const router = express.Router();
const {
  receiveSensorData,
  getLatestReading,
  getAllReadings,
  getDeviceCommand,
  getBaselineStatus,
  resetBaselineHandler,
} = require('../controllers/sensorController');
const deviceKey = require('../middleware/deviceKey');
const { protect, optionalAuth } = require('../middleware/auth');

// ─── الجهاز (ESP32): مفتاح x-api-key ─────────────────────────────────────────
router.post('/data', deviceKey, receiveSensorData);
router.get('/command', deviceKey, getDeviceCommand);

// ─── الداشبورد: تسجيل دخول (JWT) ─────────────────────────────────────────────
router.get('/latest', optionalAuth, getLatestReading);
router.get('/all', optionalAuth, getAllReadings);
router.get('/baseline', optionalAuth, getBaselineStatus);
router.post('/baseline/reset', protect, resetBaselineHandler);

module.exports = router;
