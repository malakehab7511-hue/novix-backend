const express = require('express');
const router = express.Router();
const { sendDeviceCommand, getDeviceState } = require('../controllers/deviceController');
const { protect } = require('../middleware/auth');

// كل مسارات التحكم محتاجة تسجيل دخول (JWT)
router.use(protect);

router.post('/:id/command', sendDeviceCommand);
router.get('/:id/state', getDeviceState);

module.exports = router;
