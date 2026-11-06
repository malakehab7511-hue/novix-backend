const jwt = require('jsonwebtoken');
const User = require('../models/user');

const protect = async (req, res, next) => {
  try {
    // جيب الـ Token من الـ Header
    let token;
    if (req.headers.authorization && 
        req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'غير مصرح لك بالدخول، برجاء تسجيل الدخول'
      });
    }

    // تحقق من الـ Token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // جيب المستخدم
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'المستخدم غير موجود'
      });
    }

    req.user = user;
    next();

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'الـ Token غير صالح'
    });
  }
};

module.exports = { protect };