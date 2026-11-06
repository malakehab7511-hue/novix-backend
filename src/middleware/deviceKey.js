const crypto = require('crypto');

let warned = false;

// مفتاح الجهاز (ESP32): بيتبعت في هيدر x-api-key ويتقارن بـ DEVICE_API_KEY
const deviceKey = (req, res, next) => {
  const expected = process.env.DEVICE_API_KEY || '';

  if (!expected) {
    // على الإنتاج المفتاح إجباري. في التطوير بنسمح مع تحذير.
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ success: false, message: 'DEVICE_API_KEY غير مضبوط على السيرفر' });
    }
    if (!warned) {
      console.warn('⚠️  DEVICE_API_KEY مش مضبوط — endpoints الجهاز مفتوحة (وضع التطوير فقط)');
      warned = true;
    }
    return next();
  }

  const supplied = Buffer.from(String(req.headers['x-api-key'] || ''));
  const wanted   = Buffer.from(expected);
  if (supplied.length !== wanted.length || !crypto.timingSafeEqual(supplied, wanted)) {
    return res.status(401).json({ success: false, message: 'مفتاح الجهاز غير صحيح أو ناقص' });
  }
  next();
};

module.exports = deviceKey;
