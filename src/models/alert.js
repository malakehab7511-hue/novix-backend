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

module.exports = mongoose.model('Alert', alertSchema);