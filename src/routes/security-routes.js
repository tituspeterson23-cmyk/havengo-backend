const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { MfaManager, PasswordPolicy } = require('../security');

const TEMP_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');

// POST /api/auth/2fa/setup — Generate TOTP secret + QR code for current user
router.post('/auth/2fa/setup', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.totp_enabled) return res.status(400).json({ error: '2FA already enabled' });
    const setup = MfaManager.setup(user.email);
    // Store secret temporarily — will be confirmed on verify
    await db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(setup.secret, req.user.userId);
    const qrDataUrl = await MfaManager.getQRCode(setup.otpauthUrl);
    res.json({ success: true, secret: setup.secret, qrCode: qrDataUrl, backupCodes: setup.backupCodes, otpauthUrl: setup.otpauthUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/2fa/verify — Confirm TOTP setup with a code
router.post('/auth/2fa/verify', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const db = getDb();
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userId);
    if (!user || !user.totp_secret) return res.status(400).json({ error: 'No TOTP secret found. Run setup first.' });
    if (!MfaManager.verifyToken(token, user.totp_secret)) return res.status(400).json({ error: 'Invalid token' });
    // Generate backup codes
    const backupCodes = [];
    for (let i = 0; i < 8; i++) backupCodes.push(require('crypto').randomBytes(4).toString('hex').toUpperCase());
    await db.prepare("UPDATE users SET totp_enabled = true, backup_codes = ? WHERE id = ?").run(JSON.stringify(backupCodes), req.user.userId);
    res.json({ success: true, message: '2FA enabled', backupCodes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/2fa/disable — Disable 2FA (requires password)
router.post('/auth/2fa/disable', authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const db = getDb();
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const bcrypt = require('bcryptjs');
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Incorrect password' });
    await db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = false, backup_codes = '[]' WHERE id = ?").run(req.user.userId);
    res.json({ success: true, message: '2FA disabled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/2fa/validate — Validate 2FA during login (exchanges temp token for real JWT)
router.post('/auth/2fa/validate', async (req, res) => {
  try {
    const { tempToken, token, backupCode } = req.body;
    if (!tempToken) return res.status(400).json({ error: 'Temp token required' });
    let payload;
    try { payload = jwt.verify(tempToken, TEMP_SECRET); } catch(e) { return res.status(401).json({ error: 'Invalid or expired temp token' }); }
    const db = getDb();
    const table = payload.role === 'provider' ? 'providers' : 'users';
    const user = await db.prepare("SELECT * FROM " + table + " WHERE id = ?").get(payload.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.totp_enabled) return res.status(400).json({ error: '2FA not enabled for this account' });
    // Check backup code first
    if (backupCode) {
      const codes = JSON.parse(user.backup_codes || '[]');
      const result = MfaManager.verifyBackupCode(backupCode, codes);
      if (!result.valid) return res.status(401).json({ error: 'Invalid backup code' });
      await db.prepare("UPDATE " + table + " SET backup_codes = ? WHERE id = ?").run(JSON.stringify(result.remainingCodes), payload.userId);
    } else {
      if (!token) return res.status(400).json({ error: 'TOTP token required' });
      if (!MfaManager.verifyToken(token, user.totp_secret)) return res.status(401).json({ error: 'Invalid TOTP token' });
    }
    // Issue real JWT with session
    const { JwtHardener, SessionManager } = require('../security');
    const hardener2 = new JwtHardener();
    const sm2 = new SessionManager(db);
    const accessToken = hardener2.signAccessToken({ userId: payload.userId, email: user.email, role: payload.role }, null);
    const refreshToken = hardener2.generateRefreshToken();
    await sm2.createSession({
      userId: payload.userId, email: user.email, role: payload.role,
      tokenHash: refreshToken.tokenHash,
      deviceInfo: {},
      ip: req.ip, fingerprint: '',
      expiresAt: refreshToken.expiresAt
    });
    res.json({ success: true, accessToken, refreshToken: refreshToken.rawToken, user: { id: user.id, name: user.firstname || user.name, email: user.email, role: payload.role } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/2fa/status — Check if user has 2FA enabled
router.get('/auth/2fa/status', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const user = await db.prepare("SELECT totp_enabled FROM users WHERE id = ?").get(req.user.userId);
    res.json({ enabled: !!(user && user.totp_enabled) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/validate-password — Client-side password validation before signup
router.post('/auth/validate-password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const policy = new PasswordPolicy();
    const result = policy.validate(password);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
