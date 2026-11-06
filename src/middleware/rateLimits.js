const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const handler = (req, res) =>
  res.status(429).json({ success: false, message: 'محاولات كتير. جربي تاني بعد شوية.' });

const base = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
};

const who = (req) => String(req.body?.email || req.body?.user_id || '').toLowerCase().slice(0, 100);

// تسجيل الدخول: 10 محاولات فاشلة / 15 دقيقة لكل (IP + إيميل)
const loginLimiter = rateLimit({
  ...base, limit: 10, skipSuccessfulRequests: true,
  keyGenerator: (req) => `login|${ipKeyGenerator(req.ip)}|${who(req)}`,
});

// كود التفعيل (6 خانات): 5 محاولات / 15 دقيقة لكل مستخدم، من أي IP
const verifyLimiter = rateLimit({
  ...base, limit: 5, skipSuccessfulRequests: true,
  keyGenerator: (req) => `verify|${who(req) || ipKeyGenerator(req.ip)}`,
});

// باقي المسارات الحساسة (تسجيل / نسيت الباسورد / ...): 20 / 15 دقيقة لكل IP
const authLimiter = rateLimit({
  ...base, limit: 20,
  keyGenerator: (req) => `auth|${ipKeyGenerator(req.ip)}`,
});

module.exports = { loginLimiter, verifyLimiter, authLimiter };
