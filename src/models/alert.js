const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['gas_leak', 'fire', 'smoke', 'high_temperature', 'combined', 'camera_offline'],
    required: true  // نوع التنبيه
  },
  message: {
    type: String,
    required: true  // رسالة التنبيه
  },
  riskLevel: {
    type: String,
    enum: ['warning', 'danger'],
    required: true  // مستوى الخطورة
  },
  sensorValues: {
    mq2: Number,
    mq6: Number,
    flame: Boolean,
    temperature: Number,
    humidity: Number
    
  },
  // تنبيهات الكاميرا
  source: {
    type: String,
    enum: ['sensor', 'camera'],
    default: 'sensor'
  },
  cameraId: { type: String, default: null },
  snapshotUrl: { type: String, default: null },
  // تكرار نفس الإنذار: بدل ما نعمل سجل جديد كل قراءة، بنزوّد العداد ونحدّث آخر وقت حصل فيه
  count: { type: Number, default: 1 },
  lastSeenAt: { type: Date, default: Date.now },
  isResolved: {
    type: Boolean,
    default: false  // هل اتحلت المشكلة؟
  },
  resolvedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

alertSchema.index({ source: 1, riskLevel: 1, isResolved: 1, lastSeenAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);