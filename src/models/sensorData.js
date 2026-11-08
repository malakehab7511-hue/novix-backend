const mongoose = require('mongoose');

const sensorDataSchema = new mongoose.Schema({
  mq2: {
    type: Number,
    required: true  // قراءة سنسور الغاز MQ-2
  },
  mq6: {
    type: Number,
    required: true  // قراءة سنسور الغاز MQ-6
  },
  flame: {
    type: Boolean,
    required: true  // هل في لهب؟ true/false
  },
  temperature: {
    type: Number,
    required: true  // درجة الحرارة من DHT11
  },
  humidity: {
    type: Number,
    required: true  // الرطوبة من DHT11
  },
  riskLevel: {
    type: String,
    enum: ['safe', 'warning', 'danger'],
    default: 'safe'  // مستوى الخطر
  },
  riskPercentage: {
    type: Number,
    default: 0  // نسبة الخطر %
  },
  servoStatus: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open'  // حالة صمام الغاز
  },
  buzzerStatus: {
    type: Boolean,
    default: false  // حالة الإنذار
  },
  relayStatus: {
    type: Boolean,
    default: false  // true = الريلاي شغال = الكهربا مقطوعة
  }
}, {
  timestamps: true  // يحفظ وقت كل قراءة تلقائياً
});

// القراءات بتتمسح تلقائياً بعد SENSOR_TTL_DAYS (الافتراضي 14 يوم) عشان قاعدة البيانات ما تمتلاش
// (قراءة كل ثانيتين = حوالي 43 ألف مستند في اليوم)
const ttlDays = Number(process.env.SENSOR_TTL_DAYS) || 14;
sensorDataSchema.index({ createdAt: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 });

module.exports = mongoose.model('SensorData', sensorDataSchema);
