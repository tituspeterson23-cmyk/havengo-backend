const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { hashPassword, comparePassword, generateToken, sanitize, isValidEmail, isValidPhone } = require('../auth');

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
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await comparePassword(pw, user.password_hash);
    if (!match) {
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
