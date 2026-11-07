require('dotenv').config();
const express = require('express');
const cors = require('cors');
const passport = require('./config/passport');

const authRoutes = require('./routes/auth');
const sensorRoutes = require('./routes/sensors');
const alertRoutes = require('./routes/alerts');
const dashboardRoutes = require('./routes/dashboard');
const visionRoutes = require('./routes/vision');
const deviceRoutes = require('./routes/devices');
const errorHandler = require('./middleware/errorHandler');
const { loginLimiter, verifyLimiter, authLimiter } = require('./middleware/rateLimits');

const app = express();

// خلف Nginx / Railway / Render: نثق في أول proxy (عشان HTTPS و IP الحقيقي يتقروا صح)
// 0 = من غير proxy (تشغيل محلي مباشر)
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

// ─── CORS: رابط/روابط الفرونت من FRONTEND_URL (ممكن أكتر من واحد بفاصلة) ──────
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173');
}
app.locals.allowedOrigins = allowedOrigins;

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);          // ESP32 / curl / vision-service (بيتحموا بالمفاتيح)
    cb(null, allowedOrigins.includes(origin));
  },
  credentials: true,
}));

// 5mb بس لحدث الكاميرا (فيه صورة base64)، وباقي الطلبات 100kb
app.use('/api/vision/event', express.json({ limit: '5mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(passport.initialize());

// ─── Rate limiting على المسارات الحساسة ───────────────────────────────────────
app.post('/api/auth/login', loginLimiter);
app.post('/api/auth/verify-email', verifyLimiter);
['register', 'forgot-password', 'reset-password', 'change-password', 'resend-verification'].forEach((p) =>
  app.post(`/api/auth/${p}`, authLimiter)
);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sensors', sensorRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/vision', visionRoutes);
app.use('/api/devices', deviceRoutes);

// Health Check
app.get('/', (req, res) => {
  res.json({ message: '🔥 Gas Control System API is running!' });
});

// Error Handler
app.use(errorHandler);

module.exports = app;
