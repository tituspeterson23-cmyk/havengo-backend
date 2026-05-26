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

async function sendPasswordResetEmail(to, resetLink) {
  const from = process.env.MAIL_FROM || 'admin@havengo.netlify.app';
  const t = getTransporter();
  if (!t) {
    console.log('Mail not configured — password reset link for', to, ':', resetLink);
    return false;
  }
  try {
    await t.sendMail({
      from, to,
      subject: 'HavenGo — Password Reset Request',
      html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#059669">HavenGo Uganda</h2><p>We received a request to reset your password.</p><p>Click the button below to set a new password. This link expires in 1 hour.</p><div style="text-align:center;margin:24px 0"><a href="' + resetLink + '" style="display:inline-block;background:#059669;color:white;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px">Reset Password</a></div><p style="color:#6b7280;font-size:14px">Or copy this link into your browser:</p><p style="word-break:break-all;font-size:12px;color:#374151;background:#f3f4f6;padding:12px;border-radius:8px">' + resetLink + '</p><hr><p style="color:#6b7280;font-size:12px">If you did not request a password reset, please ignore this email.</p></div>'
    });
    return true;
  } catch (e) {
    console.error('Password reset mail error:', e.message);
    return false;
  }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
