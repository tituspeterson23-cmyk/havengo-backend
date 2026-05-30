const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../database');
const { hashPassword, comparePassword, generateToken, sanitize, isValidEmail, isValidPhone } = require('../auth');
const { sendVerificationEmail } = require('../mail');
const { getFirebaseAuth, initFirebaseAdmin } = require('../firebase-admin');
const { JwtHardener, AccountLockout, SessionManager } = require('../security');

const hardener = new JwtHardener();

function getLockout() {
  return new AccountLockout(getDb());
}

function getSessionManager() {
  return new SessionManager(getDb());
}

// POST /api/auth/check-phone
router.get('/check-phone', async (req, res) => {
  try {
    const identifier = req.query.identifier;
    if (!identifier) return res.status(400).json({ error: 'Identifier is required' });
    const db = getDb();
    const existing = await db.prepare('SELECT id FROM users WHERE email = $1 OR phone = $1 LIMIT 1').get(identifier);
    res.json({ exists: !!existing });
  } catch (e) {
    console.error('Check phone error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/send-verification-code
router.post('/send-verification-code', async (req, res) => {
  try {
    const { identifier, type } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Identifier is required' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const db = getDb();
    await db.prepare("UPDATE verification_codes SET used = 1 WHERE identifier = $1 AND used = 0").run(identifier);
    await db.prepare("INSERT INTO verification_codes (identifier, code, type, expires_at) VALUES ($1, $2, $3, $4)")
      .run(identifier, code, type || 'email', expiresAt);

    if (type === 'email') {
      sendVerificationEmail(identifier, code).then(sent => {
        if (sent) {
          console.log('Verification code emailed to', identifier);
        } else {
          console.log('Mail not configured, code for', identifier, ':', code);
        }
      });
    } else {
      console.log('Verification code for', identifier, ':', code);
    }

    res.json({ success: true, message: 'Verification code sent', code: code });
  } catch (e) {
    console.error('Send code error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/verify-code
router.post('/verify-code', async (req, res) => {
  try {
    const { identifier, code } = req.body;
    if (!identifier || !code) return res.status(400).json({ error: 'Identifier and code are required' });
    const db = getDb();
    const valid = await db.prepare("SELECT * FROM verification_codes WHERE identifier = $1 AND code = $2 AND used = 0 AND expires_at > NOW()").get(identifier, code);
    if (!valid) return res.status(400).json({ error: 'Invalid or expired verification code' });
    await db.prepare("UPDATE verification_codes SET used = 1 WHERE id = $1").run(valid.id);
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
    const existing = await db.prepare('SELECT id FROM users WHERE email = $1 OR phone = $2').get(em, ph);
    if (existing) {
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const hash = await hashPassword(pw);
    const bm = bitmoji || '😊';
    const signupBonus = 2000000;
    await db.prepare('INSERT INTO users (firstname, lastname, email, phone, password_hash, bitmoji, balance) VALUES ($1, $2, $3, $4, $5, $6, $7)')
      .run(fname, lname, em, ph, hash, bm, signupBonus);

    const token = generateToken({ email: em, role: 'customer', firstname: fname });
    res.json({ success: true, token, user: { firstname: fname, lastname: lname, email: em, phone: ph, bitmoji: bm, balance: signupBonus } });
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
    const lockout = getLockout();

    // Check if account is locked
    const locked = await lockout.isLocked(id);
    if (locked) {
      return res.status(429).json({ error: 'Account temporarily locked due to too many failed attempts. Try again later.' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE email = $1 OR phone = $2').get(id, id);
    if (!user) {
      return res.status(401).json({ user_not_found: true, error: 'Invalid credentials' });
    }

    if (!(await comparePassword(pw, user.password_hash))) {
      await lockout.recordFailedAttempt(user.email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Successful login — reset lockout and create session
    await lockout.resetAttempts(user.email);

    const delReq = await db.prepare("SELECT id FROM deletion_requests WHERE identifier = $1 AND type = 'customer'").get(id);
    if (delReq) {
      await db.prepare('DELETE FROM deletion_requests WHERE id = $1').run(delReq.id);
    }

    const accessToken = hardener.signAccessToken(
      { userId: user.id, email: user.email, role: 'customer' },
      null
    );
    const refreshToken = hardener.generateRefreshToken();

    // Create session in DB
    const sm = getSessionManager();
    await sm.createSession({
      userId: user.id,
      email: user.email,
      role: 'customer',
      tokenHash: refreshToken.tokenHash,
      deviceInfo: req.headers['user-agent'] ? { ua: req.headers['user-agent'] } : {},
      ip: req.ip,
      fingerprint: '',
      expiresAt: refreshToken.expiresAt
    });

    res.json({
      success: true,
      token: accessToken,
      accessToken,
      refreshToken: refreshToken.rawToken,
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
    const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
    const adminPhone = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_phone'").pluck().get();
    const adminHash = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_password_hash'").pluck().get();

    if ((id !== adminEmail && id !== adminPhone) || !adminHash) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const match = await comparePassword(pw, adminHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const accessToken = hardener.signAccessToken(
      { userId: 0, email: adminEmail, role: 'admin' },
      null
    );
    const refreshToken = hardener.generateRefreshToken();

    // Create admin session
    const sm = getSessionManager();
    await sm.createSession({
      userId: 0,
      email: adminEmail,
      role: 'admin',
      tokenHash: refreshToken.tokenHash,
      deviceInfo: {},
      ip: req.ip,
      fingerprint: '',
      expiresAt: refreshToken.expiresAt
    });

    res.json({
      success: true,
      token: accessToken,
      accessToken,
      refreshToken: refreshToken.rawToken,
      admin: { name: 'Admin', email: adminEmail }
    });
  } catch (e) {
    console.error('Admin login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/firebase-login
router.post('/firebase-login', async (req, res) => {
  try {
    const fbAuth = getFirebaseAuth();
    if (!fbAuth) {
      return res.status(503).json({ error: 'Firebase not configured' });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email required' });
    }

    const password = Math.random().toString(36).slice(2, 14) + 'A1!';

    try {
      const userRecord = await fbAuth.getUserByEmail(email);
      await fbAuth.updateUser(userRecord.uid, { password });
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        await fbAuth.createUser({ email, password });
      } else {
        throw e;
      }
    }

    res.json({ email, password });
  } catch (e) {
    console.error('Firebase login error:', e);
    res.status(500).json({ error: 'Failed to setup Firebase login' });
  }
});

module.exports = router;
