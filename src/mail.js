const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT || '587'),
      secure: process.env.MAIL_SECURE === 'true',
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
    });
  }
  return transporter;
}

async function sendVerificationEmail(to, code) {
  const from = process.env.MAIL_FROM || 'admin@havengo.netlify.app';
  const t = getTransporter();
  if (!t) {
    console.log('Mail not configured — verification code for', to, ':', code);
    return false;
  }
  try {
    await t.sendMail({
      from, to,
      subject: 'HavenGo — Your Verification Code',
      html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#059669">HavenGo Uganda</h2><p>Your verification code is:</p><div style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#f0fdf4;padding:16px;text-align:center;border-radius:12px;margin:16px 0">' + code + '</div><p>This code expires in 10 minutes.</p><hr><p style="color:#6b7280;font-size:12px">If you did not request this, ignore this email.</p></div>'
    });
    return true;
  } catch (e) {
    console.error('Mail send error:', e.message);
    return false;
  }
}

module.exports = { sendVerificationEmail };
