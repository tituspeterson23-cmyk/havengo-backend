const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../database');
const { hashPassword, comparePassword, generateToken, sanitize, isValidEmail, isValidPhone } = require('../auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../mail');

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
    const user = await db.prepare('SELECT * FROM users WHERE email = $1 OR phone = $2').get(id, id);
    if (!user) {
      if (req.body.restoring && req.body.firstname && req.body.lastname && req.body.phone) {
        const hash = await hashPassword(pw);
        await db.prepare('DELETE FROM users WHERE email = $1').run(id);
        await db.prepare('INSERT INTO users (firstname, lastname, email, phone, password_hash, bitmoji) VALUES ($1, $2, $3, $4, $5, $6)')
          .run(sanitize(req.body.firstname), sanitize(req.body.lastname), id, sanitize(req.body.phone), hash, sanitize(req.body.bitmoji || '😊'));
        const newUser = await db.prepare('SELECT * FROM users WHERE email = $1').get(id);
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

    const delReq = await db.prepare("SELECT id FROM deletion_requests WHERE identifier = $1 AND type = 'customer'").get(id);
    if (delReq) {
      await db.prepare('DELETE FROM deletion_requests WHERE id = $1').run(delReq.id);
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

    const token = generateToken({ email: adminEmail, role: 'admin' });
    res.json({ success: true, token, admin: { name: 'Admin', email: adminEmail } });
  } catch (e) {
    console.error('Admin login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const em = sanitize(email || '');
    if (!em || !isValidEmail(em)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    const db = getDb();

    // Check if user exists (either customer or provider)
    const user = await db.prepare("SELECT email FROM users WHERE email = $1").get(em);
    const provider = await db.prepare("SELECT email FROM providers WHERE email = $1").get(em);
    const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();

    // Always respond the same way to prevent email enumeration
    if (!user && !provider && em !== adminEmail) {
      return res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
    }

    // Generate reset token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await db.prepare("UPDATE password_resets SET used = 1 WHERE email = $1 AND used = 0").run(em);
    await db.prepare("INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, $3)").run(em, token, expiresAt);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = frontendUrl + '/reset-password?token=' + token + '&email=' + encodeURIComponent(em);

    sendPasswordResetEmail(em, resetLink).then(sent => {
      if (sent) {
        console.log('Password reset email sent to', em);
      } else {
        console.log('Mail not configured — reset link for', em, ':', resetLink);
      }
    });

    res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
  } catch (e) {
    console.error('Forgot password error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, email, password } = req.body;
    const em = sanitize(email || '');
    const pw = password || '';

    if (!token || !em || !pw) {
      return res.status(400).json({ error: 'Token, email, and new password are required' });
    }
    if (pw.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDb();
    const record = await db.prepare("SELECT * FROM password_resets WHERE email = $1 AND token = $2 AND used = 0 AND expires_at > NOW()").get(em, token);

    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const hash = await hashPassword(pw);

    // Check if it's a customer user or provider
    const user = await db.prepare("SELECT id FROM users WHERE email = $1").get(em);
    const provider = await db.prepare("SELECT id FROM providers WHERE email = $1").get(em);
    const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();

    if (user) {
      await db.prepare("UPDATE users SET password_hash = $1 WHERE email = $2").run(hash, em);
    } else if (provider) {
      await db.prepare("UPDATE providers SET password_hash = $1 WHERE email = $2").run(hash, em);
    } else if (em === adminEmail) {
      await db.prepare("UPDATE admin_settings SET value = $1 WHERE key = 'admin_password_hash'").run(hash);
    } else {
      return res.status(400).json({ error: 'Account not found' });
    }

    // Mark token as used
    await db.prepare("UPDATE password_resets SET used = 1 WHERE id = $1").run(record.id);

    res.json({ success: true, message: 'Password has been reset successfully.' });
  } catch (e) {
    console.error('Reset password error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
