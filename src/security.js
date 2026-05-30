const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ACCESS_EXPIRY = 900; // 15 min
const REFRESH_EXPIRY = 604800; // 7 days

class JwtHardener {
  constructor(opts = {}) {
    this.accessSecret = opts.accessSecret || ACCESS_SECRET;
    this.accessExpiry = opts.accessExpiry || ACCESS_EXPIRY;
    this.refreshExpiry = opts.refreshExpiry || REFRESH_EXPIRY;
    this.revokedTokens = new Set();
  }

  signAccessToken(payload, fingerprint) {
    const tokenPayload = {
      sub: payload.userId,
      email: payload.email,
      role: payload.role,
      type: 'access',
      fpr: fingerprint ? this._hash(fingerprint) : null,
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000)
    };
    return jwt.sign(tokenPayload, this.accessSecret, {
      expiresIn: this.accessExpiry,
      algorithm: 'HS512'
    });
  }

  generateRefreshToken() {
    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = this._hash(rawToken);
    return {
      rawToken,
      tokenHash,
      expiresAt: Math.floor(Date.now() / 1000) + this.refreshExpiry
    };
  }

  verifyAccessToken(token, expectedFingerprint) {
    if (this.revokedTokens.has(token)) {
      throw new Error('Token has been revoked');
    }
    const decoded = jwt.verify(token, this.accessSecret, { algorithms: ['HS512'] });
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }
    if (decoded.fpr && expectedFingerprint) {
      if (decoded.fpr !== this._hash(expectedFingerprint)) {
        throw new Error('Token fingerprint mismatch');
      }
    }
    return decoded;
  }

  revokeToken(token) {
    this.revokedTokens.add(token);
  }

  _hash(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
  }
}

class SessionManager {
  constructor(db) {
    this.db = db;
  }

  async createSession(session) {
    await this.db.prepare(
      `INSERT INTO sessions (user_id, email, role, token_hash, device_info, ip, fingerprint, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, to_timestamp(?), NOW())`
    ).run(
      session.userId, session.email, session.role,
      session.tokenHash, JSON.stringify(session.deviceInfo || {}),
      session.ip || '', session.fingerprint || '',
      session.expiresAt
    );
  }

  async getUserSessions(userId) {
    return await this.db.prepare(
      `SELECT id, device_info, ip, created_at, last_activity
       FROM sessions
       WHERE user_id = ? AND expires_at > NOW() AND revoked = 0
       ORDER BY created_at DESC`
    ).all(userId);
  }

  async getSessionByTokenHash(tokenHash) {
    return await this.db.prepare(
      `SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > NOW()`
    ).get(tokenHash);
  }

  async revokeSession(sessionId) {
    await this.db.prepare(
      `UPDATE sessions SET revoked = 1, revoked_at = NOW() WHERE id = ?`
    ).run(sessionId);
  }

  async revokeByTokenHash(tokenHash) {
    await this.db.prepare(
      `UPDATE sessions SET revoked = 1, revoked_at = NOW() WHERE token_hash = ?`
    ).run(tokenHash);
  }

  async revokeOtherSessions(userId, currentSessionId) {
    await this.db.prepare(
      `UPDATE sessions SET revoked = 1, revoked_at = NOW()
       WHERE user_id = ? AND id != ? AND revoked = 0`
    ).run(userId, currentSessionId);
  }

  async revokeAllUserSessions(userId) {
    await this.db.prepare(
      `UPDATE sessions SET revoked = 1, revoked_at = NOW()
       WHERE user_id = ? AND revoked = 0`
    ).run(userId);
  }

  async enforceMaxSessions(userId, maxSessions = 5) {
    const active = await this.db.prepare(
      `SELECT id FROM sessions
       WHERE user_id = ? AND expires_at > NOW() AND revoked = 0
       ORDER BY created_at DESC`
    ).all(userId);
    if (active.length > maxSessions) {
      const toRevoke = active.slice(maxSessions);
      for (const s of toRevoke) {
        await this.revokeSession(s.id);
      }
    }
  }

  async touchSession(sessionId) {
    await this.db.prepare(
      `UPDATE sessions SET last_activity = NOW() WHERE id = ?`
    ).run(sessionId);
  }

  async getFingerprint(req) {
    const parts = [
      req.headers['user-agent'] || '',
      req.headers['accept-language'] || '',
      req.headers['sec-ch-ua'] || ''
    ];
    return crypto.createHash('sha256').update(parts.join('|||')).digest('hex');
  }
}

class AccountLockout {
  constructor(db) {
    this.db = db;
  }

  async recordFailedAttempt(email) {
    const result = await this.db.prepare(
      `UPDATE users SET failed_attempts = COALESCE(failed_attempts, 0) + 1 WHERE email = ? RETURNING failed_attempts`
    ).get(email);
    let attempts = result ? result.failed_attempts : 1;
    let lockedUntil = null;
    if (attempts >= 10) {
      lockedUntil = new Date(Date.now() + 3600000);
    } else if (attempts >= 5) {
      lockedUntil = new Date(Date.now() + 900000);
    }
    if (lockedUntil) {
      await this.db.prepare(
        `UPDATE users SET locked_until = ? WHERE email = ?`
      ).run(lockedUntil.toISOString(), email);
    }
    return { locked: !!lockedUntil, lockedUntil, attempts };
  }

  async recordProviderFailedAttempt(email) {
    const result = await this.db.prepare(
      `UPDATE providers SET failed_attempts = COALESCE(failed_attempts, 0) + 1 WHERE email = ? RETURNING failed_attempts`
    ).get(email);
    let attempts = result ? result.failed_attempts : 1;
    let lockedUntil = null;
    if (attempts >= 10) {
      lockedUntil = new Date(Date.now() + 3600000);
    } else if (attempts >= 5) {
      lockedUntil = new Date(Date.now() + 900000);
    }
    if (lockedUntil) {
      await this.db.prepare(
        `UPDATE providers SET locked_until = ? WHERE email = ?`
      ).run(lockedUntil.toISOString(), email);
    }
    return { locked: !!lockedUntil, lockedUntil, attempts };
  }

  async resetAttempts(email) {
    await this.db.prepare(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE email = ?`
    ).run(email);
  }

  async resetProviderAttempts(email) {
    await this.db.prepare(
      `UPDATE providers SET failed_attempts = 0, locked_until = NULL WHERE email = ?`
    ).run(email);
  }

  async isLocked(email) {
    const user = await this.db.prepare(
      `SELECT locked_until FROM users WHERE email = ?`
    ).get(email);
    if (!user || !user.locked_until) {
      const prov = await this.db.prepare(
        `SELECT locked_until FROM providers WHERE email = ?`
      ).get(email);
      if (!prov || !prov.locked_until) return false;
      return new Date(prov.locked_until) > new Date();
    }
    return new Date(user.locked_until) > new Date();
  }
}

// ============================================================================
// 2. MFA / 2FA — TOTP with Backup Codes
// ============================================================================
// Dependencies: speakeasy, qrcode (both installed)

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

class MfaManager {
  static setup(userEmail, issuer = 'HavenGo') {
    const secret = speakeasy.generateSecret({ name: issuer + ':' + userEmail, issuer });
    const backupCodes = [];
    for (let i = 0; i < 8; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return { secret: secret.base32, otpauthUrl: secret.otpauth_url, backupCodes };
  }

  static async getQRCode(otpauthUrl) {
    return await QRCode.toDataURL(otpauthUrl);
  }

  static verifyToken(token, secret) {
    return speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 });
  }

  static verifyBackupCode(code, userBackupCodes) {
    const idx = userBackupCodes.indexOf(code);
    if (idx === -1) return { valid: false, remainingCodes: userBackupCodes };
    const remaining = userBackupCodes.slice();
    remaining.splice(idx, 1);
    return { valid: true, remainingCodes: remaining };
  }
}

// ============================================================================
// 3. PASSWORD POLICY
// ============================================================================

const COMMON_PASSWORDS = new Set([
  '123456','password','12345678','qwerty','123456789','12345','1234','111111','1234567','sunshine',
  'qwerty123','iloveyou','princess','admin','welcome','666666','abc123','football','123123','monkey',
  '654321','!@#$%^&*','charlie','aa123456','donald','password1','qwerty12345','1234567890','letmein',
  'password123','dragon','baseball','adobe123','admin123','master','photoshop','ashley','batman',
  'trustno1','hottie','access','flower','starwars','zxcvbnm','lovely','passw0rd','shadow','michael',
  '!@#$%^&','jordan','buster','jennifer','password!','superman','solo','tigger','harley','robert',
  'hunter','ranger','andrew','love123','11111111','thomas','joshua','pepper','matthew','daniel',
  'george','computer','amanda','orange','ginger','biteme','freedom','cheese','summer','secret',
  'corvette','fender','midnight','asshole','buthead','whatever','1q2w3e4r','nicole','cowboy',
  'steelers','fuckyou','dallas','asdfgh','qwertyuiop','passion','spider','killer','jasper','james'
]);

class PasswordPolicy {
  constructor(opts) {
    opts = opts || {};
    this.minLength = opts.minLength || 8;
    this.requireUppercase = opts.requireUppercase !== false;
    this.requireLowercase = opts.requireLowercase !== false;
    this.requireDigits = opts.requireDigits !== false;
    this.requireSpecial = opts.requireSpecial !== false;
    this.maxHistory = opts.maxHistory || 5;
  }

  validate(password) {
    const errors = [];
    if (password.length < this.minLength) errors.push('Must be at least ' + this.minLength + ' characters');
    if (this.requireUppercase && !/[A-Z]/.test(password)) errors.push('Must contain an uppercase letter');
    if (this.requireLowercase && !/[a-z]/.test(password)) errors.push('Must contain a lowercase letter');
    if (this.requireDigits && !/[0-9]/.test(password)) errors.push('Must contain a digit');
    if (this.requireSpecial && !/[^A-Za-z0-9]/.test(password)) errors.push('Must contain a special character');
    if (COMMON_PASSWORDS.has(password.toLowerCase())) errors.push('This password is too common');
    return { valid: errors.length === 0, errors };
  }

  async checkHistory(db, userId, newPassword) {
    const rows = await db.prepare(
      'SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, this.maxHistory);
    const bcrypt = require('bcryptjs');
    for (const row of rows) {
      if (await bcrypt.compare(newPassword, row.password_hash)) {
        return { reused: true, message: 'Cannot reuse a recent password' };
      }
    }
    return { reused: false };
  }

  async addToHistory(db, userId, passwordHash) {
    await db.prepare(
      'INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, NOW())'
    ).run(userId, passwordHash);
    // Prune old entries beyond maxHistory
    await db.prepare(
      'DELETE FROM password_history WHERE user_id = ? AND id NOT IN (SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)'
    ).run(userId, userId, this.maxHistory);
  }
}

// ============================================================================
// 10. PAYMENT SECURITY
// ============================================================================

class PaymentSecurity {
  constructor(hmacKey) {
    this.hmacKey = hmacKey || crypto.randomBytes(32).toString('hex');
    this.processedIdempotencyKeys = new Set();
  }

  // 10a. Signed transaction payloads
  signTransactionPayload(data) {
    const payload = Object.assign({}, data, { nonce: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000) });
    const serialized = JSON.stringify(payload);
    const signature = crypto.createHmac('sha384', this.hmacKey).update(serialized).digest('base64url');
    return { payload: Buffer.from(serialized).toString('base64url'), signature };
  }

  verifyTransactionPayload(encodedPayload, signature) {
    try {
      const serialized = Buffer.from(encodedPayload, 'base64url').toString('utf8');
      const expectedSig = crypto.createHmac('sha384', this.hmacKey).update(serialized).digest('base64url');
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return { valid: false, data: null, error: 'Invalid signature' };
      }
      const data = JSON.parse(serialized);
      if (data.iat && (Math.floor(Date.now() / 1000) - data.iat) > 300) {
        return { valid: false, data: null, error: 'Payload expired' };
      }
      return { valid: true, data, error: null };
    } catch (e) {
      return { valid: false, data: null, error: e.message };
    }
  }

  // 10c. Idempotency — prevent double-spending
  checkIdempotency(key) {
    if (this.processedIdempotencyKeys.has(key)) return false;
    this.processedIdempotencyKeys.add(key);
    setTimeout(function(self, k) { self.processedIdempotencyKeys.delete(k); }, 86400000, this, key);
    return true;
  }

  static generateIdempotencyKey(userId, amount, nonce) {
    return crypto.createHash('sha256').update(userId + ':' + amount + ':' + (nonce || crypto.randomUUID())).digest('hex');
  }

  // 10e. Mobile Money validation (UG)
  static validateMobileMoneyPhone(phone) {
    const errors = [];
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
    if (cleaned.startsWith('256') && !cleaned.startsWith('+256')) cleaned = '+' + cleaned;
    const patterns = [/^\+2567[0-9]{8}$/, /^07[0-9]{8}$/, /^2567[0-9]{8}$/];
    let valid = false;
    let normalized = cleaned;
    for (const pat of patterns) {
      if (pat.test(cleaned)) { valid = true; if (cleaned.startsWith('07')) normalized = '+256' + cleaned.slice(1); else if (cleaned.startsWith('256')) normalized = '+' + cleaned; break; }
    }
    if (!valid) errors.push('Invalid Ugandan mobile money number');
    const prefixDigits = normalized.slice(4, 6);
    const network = ['77','78'].includes(prefixDigits) ? 'MTN' : (['75','70','76'].includes(prefixDigits) ? 'Airtel' : (['74'].includes(prefixDigits) ? 'Africell' : 'unknown'));
    return { valid, normalized, network, errors };
  }

  static generatePaymentReference() {
    return 'HG-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  // 10f. Digital receipts
  generateReceipt(transaction) {
    const receipt = {
      receiptId: 'RCP-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      transactionId: transaction.id, userId: transaction.userId,
      serviceName: transaction.serviceName, amount: transaction.amount,
      currency: 'UGX', paymentMethod: transaction.paymentMethod || 'Mobile Money',
      reference: transaction.reference, status: 'completed', timestamp: new Date().toISOString()
    };
    const serialized = JSON.stringify(receipt);
    receipt.signature = crypto.createHmac('sha512', this.hmacKey).update(serialized).digest('hex');
    return receipt;
  }

  verifyReceipt(receipt) {
    const sig = receipt.signature;
    delete receipt.signature;
    const serialized = JSON.stringify(receipt);
    const expected = crypto.createHmac('sha512', this.hmacKey).update(serialized).digest('hex');
    receipt.signature = sig;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  // 10h. Audit trail
  static async auditLog(db, entry) {
    await db.prepare(
      'INSERT INTO audit_log (user_id, action, amount, reference, description, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())'
    ).run(entry.userId, entry.action, entry.amount || 0, entry.reference || '', entry.description || '', entry.ipAddress || '');
  }

  static async getAuditTrail(db, userId, limit) {
    limit = limit || 100;
    if (userId) return await db.prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
    return await db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit);
  }
}

module.exports = { JwtHardener, SessionManager, AccountLockout, MfaManager, PasswordPolicy, PaymentSecurity };
