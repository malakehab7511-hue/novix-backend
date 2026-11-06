const axios = require('axios');
const nodemailer = require('nodemailer');

// ─── طريقة الإرسال ───────────────────────────────────────────────────────────
// على Railway (الخطة المجانية/التجريبية) بورت SMTP محجوب، فبنبعت عن طريق Brevo HTTP API.
// لو BREVO_API_KEY مش موجود (تشغيل محلي) بنرجع لـ SMTP العادي (Gmail).
//
// المتغيرات في Railway:
//   BREVO_API_KEY = مفتاح الـ API من Brevo
//   EMAIL_FROM    = الإيميل اللي اتحققتي منه كـ Sender في Brevo (مثلاً marweyosry@gmail.com)
//   EMAIL_FROM_NAME (اختياري) = الاسم اللي يظهر للمستلم، الافتراضي NOVIX

const FROM_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_USER;
const FROM_NAME  = process.env.EMAIL_FROM_NAME || 'NOVIX';

let smtpTransporter = null;
const getSmtp = () => {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: false,
      family: 4,                    // IPv4 بس (IPv6 كان بيدي ENETUNREACH)
      connectionTimeout: 10000,     // مايفضلش معلّق دقيقتين
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return smtpTransporter;
};

async function sendMail({ to, subject, text }) {
  if (process.env.BREVO_API_KEY) {
    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: to }],
        subject,
        textContent: text,
      },
      {
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
        timeout: 10000,
      }
    );
    return;
  }
  await getSmtp().sendMail({ from: FROM_EMAIL, to, subject, text });
}

// بعت كود التحقق
const sendVerificationEmail = async (email, username, code) => {
  try {
    await sendMail({
      to: email,
      subject: 'تفعيل حسابك في NOVIX',
      text: `مرحباً ${username},\n\nكود التفعيل الخاص بك هو: ${code}\n\nصالح لمدة ساعة واحدة فقط.\n\nشكراً لانضمامك`,
    });
    return true;
  } catch (error) {
    // مفيش تسريب لمفاتيح: بنطبع رسالة الخطأ من Brevo لو موجودة
    console.error('Email error:', error.response?.data || error.message);
    return false;
  }
};

// بعت رابط إعادة تعيين الباسورد
const sendResetPasswordEmail = async (email, username, token) => {
  try {
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await sendMail({
      to: email,
      subject: 'إعادة تعيين كلمة المرور - NOVIX',
      text: `مرحباً ${username},\n\nلإعادة تعيين كلمة المرور اضغط على الرابط:\n${resetLink}\n\nصالح لمدة ساعة واحدة فقط.\n\nإذا لم تطلب هذا تجاهل هذا البريد.`,
    });
    return true;
  } catch (error) {
    console.error('Email error:', error.response?.data || error.message);
    return false;
  }
};

module.exports = { sendVerificationEmail, sendResetPasswordEmail };
