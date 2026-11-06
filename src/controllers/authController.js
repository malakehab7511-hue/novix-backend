const User = require('../models/user');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendVerificationEmail, sendResetPasswordEmail } = require('../config/email');

// توليد JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  });
};

// ✅ Register
const register = async (req, res) => {
  try {
    const { username, email, password, phone, first_name, last_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    if (await User.findOne({ email })) {
      return res.status(400).json({ success: false, message: 'هذا البريد الإلكتروني مسجل بالفعل' });
    }

    if (phone && await User.findOne({ phone })) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل بالفعل' });
    }

    if (phone && !/^\+?1?\d{9,15}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف غير صحيح' });
    }

    // كود التحقق
    const verification_code = crypto.randomBytes(3).toString('hex').toUpperCase();

    const user = await User.create({
      username,
      email,
      password,
      phone: phone || null,
      first_name: first_name || '',
      last_name: last_name || '',
      verification_code,
      verification_code_created_at: new Date()
    });

    // بعت إيميل التحقق
    await sendVerificationEmail(email, username, verification_code);

    res.status(201).json({
      success: true,
      user_id: user._id,
      username: user.username,
      email: user.email,
      message: 'تم إنشاء الحساب بنجاح. برجاء تفعيل بريدك الإلكتروني'
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Verify Email
const verifyEmail = async (req, res) => {
  try {
    const { user_id, code } = req.body;

    if (!user_id || !code) {
      return res.status(400).json({ success: false, message: 'user_id و code مطلوبين' });
    }

    const user = await User.findById(user_id);

    if (!user || user.verification_code !== code) {
      return res.status(400).json({ success: false, message: 'كود التفعيل غير صحيح' });
    }

    // تحقق من صلاحية الكود (ساعة واحدة)
    const codeAge = new Date() - new Date(user.verification_code_created_at);
    if (codeAge > 3600000) {
      return res.status(400).json({ success: false, message: 'انتهت صلاحية كود التفعيل' });
    }

    user.email_verified = true;
    user.verification_code = null;
    await user.save();

    res.json({ success: true, message: 'تم تفعيل البريد الإلكتروني بنجاح' });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Resend Verification Code (إعادة إرسال كود التفعيل)
const resendVerification = async (req, res) => {
  const generic = { success: true, message: 'إذا كان الحساب موجودًا وغير مفعّل، تم إرسال كود جديد' };
  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, message: 'user_id مطلوب' });
    }

    let user = null;
    try { user = await User.findById(user_id); } catch { user = null; }

    // نفس الرد في كل الحالات (حساب غير موجود / مفعّل بالفعل) عشان محدش يستخدمها لتخمين الحسابات
    if (!user || user.email_verified) return res.json(generic);

    // مهلة 60 ثانية بين كل إرسال
    const last = user.verification_code_created_at ? new Date(user.verification_code_created_at).getTime() : 0;
    if (Date.now() - last < 60 * 1000) {
      return res.status(429).json({ success: false, message: 'استني دقيقة قبل ما تطلبي كود جديد' });
    }

    user.verification_code = crypto.randomBytes(3).toString('hex').toUpperCase();
    user.verification_code_created_at = new Date();
    await user.save();
    await sendVerificationEmail(user.email, user.username, user.verification_code);

    res.json(generic);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني وكلمة المرور مطلوبين' });
    }

    const user = await User.findOne({ email });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ success: false, message: 'برجاء تفعيل بريدك الإلكتروني أولاً' });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user_id: user._id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      address: user.address,
      message: 'تم تسجيل الدخول بنجاح'
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get User
const getUser = async (req, res) => {
  try {
    const user = req.user;
    res.json({
      success: true,
      data: {
        id: user._id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone || '',
        address: user.address || '',
        email_verified: user.email_verified,
        date_joined: user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Update Profile
const updateProfile = async (req, res) => {
  try {
    const { phone, address, first_name, last_name } = req.body;
    const user = req.user;

    if (phone && !/^\+?1?\d{9,15}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف غير صحيح' });
    }

    if (phone && phone !== user.phone) {
      const exists = await User.findOne({ phone, _id: { $ne: user._id } });
      if (exists) {
        return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل بالفعل' });
      }
    }

    const updated = await User.findByIdAndUpdate(
      user._id,
      { phone, address, first_name, last_name },
      { new: true }
    ).select('-password');

    res.json({ success: true, data: updated, message: 'تم تحديث الملف الشخصي بنجاح' });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Change Password
const changePassword = async (req, res) => {
  try {
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
      return res.status(400).json({ success: false, message: 'كلمة المرور القديمة والجديدة مطلوبين' });
    }

    const user = await User.findById(req.user._id);

    if (!(await user.comparePassword(old_password))) {
      return res.status(400).json({ success: false, message: 'كلمة المرور القديمة غير صحيحة' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    user.password = new_password;
    await user.save();

    const token = generateToken(user._id);

    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح', new_token: token });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Logout
const logout = async (req, res) => {
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
};

// ✅ Forgot Password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني مطلوب' });
    }

    const user = await User.findOne({ email });

    if (user) {
      const reset_token = crypto.randomBytes(32).toString('hex');
      user.reset_token = reset_token;
      user.reset_token_created_at = new Date();
      await user.save();
      await sendResetPasswordEmail(email, user.username, reset_token);
    }

    res.json({ success: true, message: 'إذا كان البريد الإلكتروني مسجلاً، سنرسل رابط إعادة التعيين' });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Reset Password
const resetPassword = async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ success: false, message: 'الرمز وكلمة المرور الجديدة مطلوبين' });
    }

    const user = await User.findOne({ reset_token: token });

    if (!user) {
      return res.status(400).json({ success: false, message: 'الرمز غير صالح' });
    }

    const tokenAge = new Date() - new Date(user.reset_token_created_at);
    if (tokenAge > 3600000) {
      return res.status(400).json({ success: false, message: 'انتهت صلاحية رابط إعادة التعيين' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    user.password = new_password;
    user.reset_token = null;
    user.reset_token_created_at = null;
    await user.save();

    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح. برجاء تسجيل الدخول مرة أخرى' });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ OAuth Callback
const oauthCallback = async (req, res) => {
  try {
    const user = req.user;
    const token = generateToken(user._id);

    res.redirect(
      `${process.env.FRONTEND_URL}/oauth/callback` +
      `?token=${token}` +
      `&user_id=${user._id}` +
      `&username=${encodeURIComponent(user.username)}` +
      `&email=${encodeURIComponent(user.email)}`
    );
  } catch (error) {
    res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?error=auth_failed`);
  }
};

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  getUser,
  updateProfile,
  changePassword,
  logout,
  forgotPassword,
  resetPassword,
  oauthCallback
};