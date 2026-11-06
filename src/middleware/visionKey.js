const crypto = require('crypto');

// حماية endpoint الـ vision-service بمفتاح API (header: x-api-key)
module.exports = (req, res, next) => {
  const expected = process.env.VISION_API_KEY;
  const got = req.headers['x-api-key'];
  if (!expected || !got) {
    return res.status(401).json({ success: false, message: 'API key مطلوب' });
  }
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, message: 'API key غير صحيح' });
  }
  next();
};
