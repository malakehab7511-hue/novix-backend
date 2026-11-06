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
const { protect } = require('../middleware/auth');

// ─── الجهاز (ESP32): مفتاح x-api-key ─────────────────────────────────────────
router.post('/data', deviceKey, receiveSensorData);
router.get('/command', deviceKey, getDeviceCommand);

// ─── الداشبورد: تسجيل دخول (JWT) ─────────────────────────────────────────────
router.get('/latest', protect, getLatestReading);
router.get('/all', protect, getAllReadings);
router.get('/baseline', protect, getBaselineStatus);
router.post('/baseline/reset', protect, resetBaselineHandler);

module.exports = router;
