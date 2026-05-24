const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../database');
const { hashPassword, comparePassword, generateToken, sanitize, isValidEmail, isValidPhone } = require('../auth');

// POST /api/auth/send-verification-code
router.post('/send-verification-code', (req, res) => {
  try {
    const { identifier, type } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Identifier is required' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const db = getDb();
    db.prepare("UPDATE verification_codes SET used = 1 WHERE identifier = ? AND used = 0").run(identifier);
    db.prepare("INSERT INTO verification_codes (identifier, code, type, expires_at) VALUES (?, ?, ?, ?)")
      .run(identifier, code, type || 'email', expiresAt);
    console.log('Verification code for', identifier, ':', code);
    res.json({ success: true, message: 'Verification code sent', code: code });
  } catch (e) {
    console.error('Send code error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/verify-code
router.post('/verify-code', (req, res) => {
  try {
    const { identifier, code } = req.body;
    if (!identifier || !code) return res.status(400).json({ error: 'Identifier and code are required' });
    const db = getDb();
    const valid = db.prepare("SELECT * FROM verification_codes WHERE identifier = ? AND code = ? AND used = 0 AND expires_at > datetime('now')").get(identifier, code);
    if (!valid) return res.status(400).json({ error: 'Invalid or expired verification code' });
    db.prepare("UPDATE verification_codes SET used = 1 WHERE id = ?").run(valid.id);
    res.json({ success: true, message: 'Verification successful', verified: true });
  } catch (e) {
    console.error('Verify code error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/register (customer)
router.post('/register', async (req, res) => {
  try {
    const { firstname, lastname, email, phone, password, bitmoji } = req.body;
    const s = (v) => sanitize(v || '');
    const fname = s(firstname);
    const lname = s(lastname);
    const em = s(email);
    const ph = s(phone);
    const pw = password || '';

    if (!fname || !lname || !em || !ph || !pw) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!isValidEmail(em)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!isValidPhone(ph)) {
      return res.status(400).json({ error: 'Phone must be 10 digits starting with 0' });
    }
    if (pw.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR phone = ?').get(em, ph);
    if (existing) {
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const hash = await hashPassword(pw);
    const bm = bitmoji || '😊';
    db.prepare('INSERT INTO users (firstname, lastname, email, phone, password_hash, bitmoji) VALUES (?, ?, ?, ?, ?, ?)')
      .run(fname, lname, em, ph, hash, bm);

    const token = generateToken({ email: em, role: 'customer', firstname: fname });
    res.json({ success: true, token, user: { firstname: fname, lastname: lname, email: em, phone: ph, bitmoji: bm } });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login (customer)
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const id = sanitize(identifier || '');
    const pw = password || '';

    if (!id || !pw) {
      return res.status(400).json({ error: 'Please enter your credentials' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ? OR phone = ?').get(id, id);
    if (!user) {
      // If the frontend signals this is a restoration after DB wipe, auto-create/replace the user
      if (req.body.restoring && req.body.firstname && req.body.lastname && req.body.phone) {
        const hash = await hashPassword(pw);
        db.prepare('DELETE FROM users WHERE email = ?').run(id);
        db.prepare('INSERT INTO users (firstname, lastname, email, phone, password_hash, bitmoji) VALUES (?, ?, ?, ?, ?, ?)')
          .run(sanitize(req.body.firstname), sanitize(req.body.lastname), id, sanitize(req.body.phone), hash, sanitize(req.body.bitmoji || '😊'));
        const newUser = db.prepare('SELECT * FROM users WHERE email = ?').get(id);
        if (newUser) {
          const token = generateToken({ email: newUser.email, role: 'customer', firstname: newUser.firstname });
          return res.json({
            success: true, token,
            user: { firstname: newUser.firstname, lastname: newUser.lastname, email: newUser.email, phone: newUser.phone, bitmoji: newUser.bitmoji, balance: newUser.balance }
          });
        }
      }
      return res.status(401).json({ user_not_found: true, error: 'Invalid credentials' });
    }

    if (!(await comparePassword(pw, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if deletion is pending and cancel it
    const delReq = db.prepare("SELECT id FROM deletion_requests WHERE identifier = ? AND type = 'customer'").get(id);
    if (delReq) {
      db.prepare('DELETE FROM deletion_requests WHERE id = ?').run(delReq.id);
    }

    const token = generateToken({ email: user.email, role: 'customer', firstname: user.firstname });
    res.json({
      success: true, token,
      user: { firstname: user.firstname, lastname: user.lastname, email: user.email, phone: user.phone, bitmoji: user.bitmoji, balance: user.balance }
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/admin/login
router.post('/admin/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const id = sanitize(identifier || '');
    const pw = password || '';

    if (!id || !pw) {
      return res.status(400).json({ error: 'Please enter your credentials' });
    }

    const db = getDb();
    const adminEmail = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
    const adminPhone = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_phone'").pluck().get();
    const adminHash = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_password_hash'").pluck().get();

    if ((id !== adminEmail && id !== adminPhone) || !adminHash) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const match = await comparePassword(pw, adminHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = generateToken({ email: adminEmail, role: 'admin' });
    res.json({ success: true, token, admin: { name: 'Admin', email: adminEmail } });
  } catch (e) {
    console.error('Admin login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
