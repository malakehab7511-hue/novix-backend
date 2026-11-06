const express = require('express');
const router = express.Router();
const {
  getAllAlerts,
  getActiveAlerts,
  resolveAlert,
  resolveAllAlerts,
} = require('../controllers/alertController');
const { protect } = require('../middleware/auth');

// كل مسارات التنبيهات محتاجة تسجيل دخول
router.use(protect);

router.get('/all', getAllAlerts);
router.get('/active', getActiveAlerts);
router.patch('/resolve-all', resolveAllAlerts);
router.patch('/resolve/:id', resolveAlert);

module.exports = router;
