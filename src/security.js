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

module.exports = { JwtHardener, SessionManager, AccountLockout };
