const app = require('./src/app');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const connectDB = require('./src/config/db');
const User = require('./src/models/user');
const { loadPersistedState } = require('./src/ai/decisionEngine');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

// الاتصال بقاعدة البيانات، وبعدها نسترجع (قفل الصمام + الـ baseline) لو السيرفر اتعمله restart
connectDB().then(loadPersistedState);

// إنشاء الـ Server
const server = http.createServer(app);

// إعداد Socket.io — الـ origins من FRONTEND_URL
const io = new Server(server, {
  cors: {
    origin: app.locals.allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// لازم JWT صالح عشان أي حد يتصل بالـ socket
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('unauthorized'));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('_id');
    if (!user) return next(new Error('unauthorized'));
    socket.userId = String(user._id);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

// تصدير io عشان نستخدمه في أي مكان
global.io = io;

io.on('connection', (socket) => {
  console.log('✅ React Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
