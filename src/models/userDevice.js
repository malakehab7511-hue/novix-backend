const mongoose = require('mongoose');

// أجهزة المستخدمين (موبايل / تابلت / كمبيوتر) المربوطة بالبيت — مش الـ ESP32
const userDeviceSchema = new mongoose.Schema({
  owner:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ownerName:  { type: String, trim: true, maxlength: 60, default: '' },   // اسم صاحب الجهاز (ممكن حد من العيلة)
  name:       { type: String, required: true, trim: true, maxlength: 60 },
  type:       { type: String, enum: ['mobile', 'tablet', 'computer'], default: 'mobile' },
  clientId:   { type: String, default: null },        // معرّف المتصفح/الموبايل اللي فتح الموقع (للتسجيل التلقائي)
  notifications: { type: Boolean, default: true },
  control:    { type: Boolean, default: false },
  lastActive: { type: Date, default: null },
}, { timestamps: true });

// جهاز واحد لكل clientId لكل مستخدم (الأجهزة اللي اتضافت يدوي مالهاش clientId)
userDeviceSchema.index(
  { owner: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }
);

module.exports = mongoose.model('UserDevice', userDeviceSchema);
