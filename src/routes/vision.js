const express = require('express');
const router = express.Router();
const visionKey = require('../middleware/visionKey');
const { protect } = require('../middleware/auth');
const {
  receiveVisionEvent, visionStatus, resetValveLatch, getSnapshot, liveFrame,
} = require('../controllers/visionController');

router.post('/event', visionKey, receiveVisionEvent);       // من vision-service (بمفتاح)
router.get('/status', protect, visionStatus);                // حالة الكاميرات + الـ latch
router.post('/reset-latch', protect, resetValveLatch);       // فك قفل الصمام يدوياً
router.get('/snapshots/:file', protect, getSnapshot);        // صورة إنذار (لازم تسجيل دخول)
router.get('/live/:id', protect, liveFrame);                 // لقطة حية من الكاميرا عبر الباك إند

module.exports = router;
