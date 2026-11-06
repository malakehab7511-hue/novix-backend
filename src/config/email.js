const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// بعت كود التحقق
const sendVerificationEmail = async (email, username, code) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'تفعيل حسابك في Gas Control System',
      text: `مرحباً ${username},\n\nكود التفعيل الخاص بك هو: ${code}\n\nصالح لمدة ساعة واحدة فقط.\n\nشكراً لانضمامك`
    });
    return true;
  } catch (error) {
    console.error('Email error:', error);
    return false;
  }
};

// بعت رابط إعادة تعيين الباسورد
const sendResetPasswordEmail = async (email, username, token) => {
  try {
const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'إعادة تعيين كلمة المرور - Gas Control System',
      text: `مرحباً ${username},\n\nلإعادة تعيين كلمة المرور اضغط على الرابط:\n${resetLink}\n\nصالح لمدة ساعة واحدة فقط.\n\nإذا لم تطلب هذا تجاهل هذا البريد.`
    });
    return true;
  } catch (error) {
    console.error('Email error:', error);
    return false;
  }
};

module.exports = { sendVerificationEmail, sendResetPasswordEmail };