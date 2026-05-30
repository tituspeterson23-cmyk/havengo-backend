const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'havengo_ug_5^Kp#9mX$2vR!qLz@8wN&bYdEfGhIj';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'havengo-aes-key-32bytes-2026-secure!';

// Generate JWT token
function generateToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// Verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Hash password with bcrypt (salt rounds = 10)
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// Compare password with hash
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// AES-256-GCM encrypt
function encrypt(text) {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'havengo-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), tag: authTag, data: encrypted });
}

// AES-256-GCM decrypt
function decrypt(encryptedJson) {
  try {
    const { iv, tag, data } = JSON.parse(encryptedJson);
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'havengo-salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

// Sanitize input - strip HTML/script tags
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/\\/g, '&#x5C;')
    .trim();
}

// Validate email
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// Validate phone (Uganda format: 0XXXXXXXXX)
function isValidPhone(phone) {
  return /^0\d{9}$/.test(phone);
}

// Short-lived token for 2FA validation step (5 min)
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '5m' });
}

module.exports = {
  generateToken,
  verifyToken,
  signToken,
  hashPassword,
  comparePassword,
  encrypt,
  decrypt,
  sanitize,
  isValidEmail,
  isValidPhone
};
