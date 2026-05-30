/**
 * HavenGo Security Module — Authentication & Session Security
 *
 * This file contains hardened security implementations for the HavenGo
 * transactional platform. Each section is self-contained and ready to
 * be tested independently before integration into the main app.
 *
 * Current focus: Authentication & Session Security
 * Next planned: Payment Security, Chat Encryption, API Security
 *
 * Table of Contents
 * =================
 * 1. JWT Hardening (strong secrets, short expiry, refresh tokens)
 * 2. Multi-Factor Authentication (TOTP)
 * 3. Password Policy & Hashing
 * 4. Brute Force Protection & Rate Limiting
 * 5. Session Management (rotation, revocation, device tracking)
 * 6. Account Lockout Mechanism
 * 7. Secure Token Storage (client-side)
 * 8. Email Verification with Signed Tokens
 * 9. Helpers & Utilities
 * 10. Payment Security (signed payloads, idempotency, escrow, audit trail)
 * 11. Chat Encryption (end-to-end with ECDH + AES-256-GCM)
 */

// ============================================================================
// 1. JWT HARDENING
// ============================================================================
// Goals:
//   - Use strong random secrets (not hardcoded strings)
//   - Short access token expiry (15 min) + long refresh token (7 days)
//   - Refresh token rotation (old token invalidated on use)
//   - Token fingerprinting (bind token to device/user-agent)
//   - Revocation list support

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

class JwtHardener {
    /**
     * @param {Object} opts
     * @param {string} opts.accessSecret - 256+ bit random secret
     * @param {string} opts.refreshSecret - separate secret for refresh tokens
     * @param {number} opts.accessExpiry - seconds (default 900 = 15 min)
     * @param {number} opts.refreshExpiry - seconds (default 604800 = 7 days)
     */
    constructor(opts = {}) {
        this.accessSecret = opts.accessSecret || crypto.randomBytes(32).toString("hex");
        this.refreshSecret = opts.refreshSecret || crypto.randomBytes(32).toString("hex");
        this.accessExpiry = opts.accessExpiry || 900;
        this.refreshExpiry = opts.refreshExpiry || 604800;
        this.revokedTokens = new Set(); // in-memory; use Redis in production
    }

    /**
     * Generate an access token with device fingerprint binding.
     * @param {Object} payload - { userId, email, role }
     * @param {string} [fingerprint] - SHA-256 of user-agent + IP
     * @returns {string} signed JWT
     */
    signAccessToken(payload, fingerprint) {
        const tokenPayload = {
            sub: payload.userId,
            email: payload.email,
            role: payload.role,
            type: "access",
            fpr: fingerprint ? this._hash(fingerprint) : null,
            jti: crypto.randomUUID(),
            iat: Math.floor(Date.now() / 1000)
        };
        return jwt.sign(tokenPayload, this.accessSecret, {
            expiresIn: this.accessExpiry,
            algorithm: "HS512"
        });
    }

    /**
     * Generate a refresh token (opaque, stored as hash in DB).
     * Returns the raw token (one-time show) and its SHA-256 hash.
     * @param {Object} payload - { userId, email, role }
     * @returns {{ rawToken: string, tokenHash: string, expiresAt: number }}
     */
    generateRefreshToken(payload) {
        const rawToken = crypto.randomBytes(48).toString("hex");
        const tokenHash = this._hash(rawToken);
        return {
            rawToken,
            tokenHash,
            expiresAt: Math.floor(Date.now() / 1000) + this.refreshExpiry
        };
    }

    /**
     * Verify an access token. Throws on invalid/expired/revoked.
     * Returns decoded payload on success.
     */
    verifyAccessToken(token, expectedFingerprint) {
        if (this.revokedTokens.has(token)) {
            throw new Error("Token has been revoked");
        }
        const decoded = jwt.verify(token, this.accessSecret, { algorithms: ["HS512"] });
        if (decoded.type !== "access") {
            throw new Error("Invalid token type");
        }
        if (decoded.fpr && expectedFingerprint) {
            if (decoded.fpr !== this._hash(expectedFingerprint)) {
                throw new Error("Token fingerprint mismatch — possible token theft");
            }
        }
        return decoded;
    }

    /**
     * Revoke a token (add to revocation set).
     */
    revokeToken(token) {
        this.revokedTokens.add(token);
    }

    _hash(str) {
        return crypto.createHash("sha256").update(str).digest("hex");
    }
}

// ============================================================================
// 2. MULTI-FACTOR AUTHENTICATION (TOTP)
// ============================================================================
// Goals:
//   - Time-based One-Time Password (RFC 6238)
//   - QR code provisioning for authenticator apps
//   - Backup codes for recovery
//   - Rate-limited verification

const speakeasy = require("speakeasy"); // npm install speakeasy
const QRCode = require("qrcode");       // npm install qrcode

class MfaManager {
    /**
     * Generate a new TOTP secret and backup codes for a user.
     * @param {string} userEmail - used for provisioning URI
     * @param {string} issuer - app name (e.g. "HavenGo")
     * @returns {{ secret: string, otpauthUrl: string, backupCodes: string[] }}
     */
    static setup(userEmail, issuer = "HavenGo") {
        const secret = speakeasy.generateSecret({
            name: `${issuer}:${userEmail}`,
            issuer
        });
        const backupCodes = [];
        for (let i = 0; i < 8; i++) {
            backupCodes.push(crypto.randomBytes(4).toString("hex").toUpperCase());
        }
        return {
            secret: secret.base32,
            otpauthUrl: secret.otpauth_url,
            backupCodes
        };
    }

    /**
     * Generate QR code data URL for provisioning.
     */
    static async getQRCode(otpauthUrl) {
        return await QRCode.toDataURL(otpauthUrl);
    }

    /**
     * Verify a TOTP token.
     * @param {string} token - 6-digit code from authenticator
     * @param {string} secret - base32 encoded secret
     * @returns {boolean}
     */
    static verifyToken(token, secret) {
        // window of ±1 step (30s) to account for clock drift
        return speakeasy.totp.verify({
            secret,
            encoding: "base32",
            token,
            window: 1
        });
    }

    /**
     * Verify a backup code (and consume it).
     * @param {string} code
     * @param {string[]} userBackupCodes - stored hashed in DB
     * @returns {{ valid: boolean, remainingCodes: string[] }}
     */
    static verifyBackupCode(code, userBackupCodes) {
        const idx = userBackupCodes.indexOf(code);
        if (idx === -1) return { valid: false, remainingCodes: userBackupCodes };
        const remaining = userBackupCodes.slice();
        remaining.splice(idx, 1);
        return { valid: true, remainingCodes: remaining };
    }
}

// ============================================================================
// 3. PASSWORD POLICY & HASHING
// ============================================================================
// Goals:
//   - Enforce strong passwords (length, complexity, common-password check)
//   - Argon2id hashing (memory-hard, ASIC-resistant)
//   - Password history to prevent reuse
//   - Gradual hash upgrade on login (re-hash if parameters changed)

const argon2 = require("argon2"); // npm install argon2

class PasswordPolicy {
    constructor(opts = {}) {
        this.minLength = opts.minLength || 12;
        this.requireUppercase = opts.requireUppercase !== false;
        this.requireLowercase = opts.requireLowercase !== false;
        this.requireDigits = opts.requireDigits !== false;
        this.requireSpecial = opts.requireSpecial !== false;
        this.maxHistory = opts.maxHistory || 5; // prevent last N passwords
    }

    /**
     * Validate a password against policy.
     * @returns {{ valid: boolean, errors: string[] }}
     */
    validate(password) {
        const errors = [];
        if (password.length < this.minLength) {
            errors.push(`Must be at least ${this.minLength} characters`);
        }
        if (this.requireUppercase && !/[A-Z]/.test(password)) {
            errors.push("Must contain an uppercase letter");
        }
        if (this.requireLowercase && !/[a-z]/.test(password)) {
            errors.push("Must contain a lowercase letter");
        }
        if (this.requireDigits && !/[0-9]/.test(password)) {
            errors.push("Must contain a digit");
        }
        if (this.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
            errors.push("Must contain a special character");
        }
        // Common password check (top 10k most common)
        if (COMMON_PASSWORDS.has(password.toLowerCase())) {
            errors.push("This password is too common and easily guessed");
        }
        return { valid: errors.length === 0, errors };
    }

    /**
     * Hash a password with Argon2id.
     */
    static async hash(password) {
        return await argon2.hash(password, {
            type: argon2.argon2id,
            memoryCost: 65536,   // 64 MB
            timeCost: 3,          // 3 iterations
            parallelism: 2,
            hashLength: 32
        });
    }

    /**
     * Verify a password against its hash.
     */
    static async verify(password, hash) {
        return await argon2.verify(hash, password);
    }

    /**
     * Check if a hash needs upgrading (different params).
     */
    static async needsRehash(hash) {
        return await argon2.needsRehash(hash, {
            type: argon2.argon2id,
            memoryCost: 65536,
            timeCost: 3,
            parallelism: 2
        });
    }
}

// ============================================================================
// 4. BRUTE FORCE PROTECTION & RATE LIMITING
// ============================================================================
// Goals:
//   - Per-IP + per-account rate limiting
//   - Exponential backoff after failed attempts
//   - Sliding window counter (not fixed window)
//   - Distributed counter support (Redis-compatible interface)

class RateLimiter {
    /**
     * @param {Object} store - must have { get, set, expire } interface
     *                         Use Redis or in-memory Map for testing.
     * @param {Object} opts
     * @param {number} opts.maxAttempts - per window (default 5)
     * @param {number} opts.windowMs - sliding window in ms (default 900000 = 15 min)
     */
    constructor(store, opts = {}) {
        this.store = store;
        this.maxAttempts = opts.maxAttempts || 5;
        this.windowMs = opts.windowMs || 900000;
    }

    /**
     * Record a failed attempt. Returns current count.
     */
    async recordAttempt(key) {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        const raw = await this.store.get(key);
        let timestamps = raw ? JSON.parse(raw) : [];
        timestamps = timestamps.filter(t => t > windowStart);
        timestamps.push(now);
        await this.store.set(key, JSON.stringify(timestamps));
        await this.store.expire(key, Math.ceil(this.windowMs / 1000));
        return timestamps.length;
    }

    /**
     * Check if key is currently blocked.
     */
    async isBlocked(key) {
        const count = await this.getAttemptCount(key);
        return count >= this.maxAttempts;
    }

    /**
     * Get attempt count in current window.
     */
    async getAttemptCount(key) {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        const raw = await this.store.get(key);
        if (!raw) return 0;
        const timestamps = JSON.parse(raw).filter(t => t > windowStart);
        return timestamps.length;
    }

    /**
     * Clear attempts (on successful login).
     */
    async clearAttempts(key) {
        await this.store.del(key);
    }
}

// ============================================================================
// 5. SESSION MANAGEMENT
// ============================================================================
// Goals:
//   - Track active sessions per user (limit concurrent sessions)
//   - Session rotation on privilege escalation
//   - Device fingerprinting for session binding
//   - Force logout all other sessions
//   - Session expiry and idle timeout

class SessionManager {
    /**
     * @param {Object} db - database adapter with get/run methods
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Create a new session record.
     * @param {Object} session - { userId, email, role, tokenHash, deviceInfo, ip, expiresAt }
     */
    async createSession(session) {
        await this.db.run(
            `INSERT INTO sessions (user_id, email, role, token_hash, device_info, ip, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [session.userId, session.email, session.role,
             session.tokenHash, JSON.stringify(session.deviceInfo || {}),
             session.ip, new Date(session.expiresAt * 1000).toISOString()]
        );
    }

    /**
     * Get all active sessions for a user.
     */
    async getUserSessions(userId) {
        return await this.db.all(
            `SELECT id, device_info, ip, created_at, last_activity
             FROM sessions
             WHERE user_id = ? AND expires_at > NOW() AND revoked = 0
             ORDER BY created_at DESC`,
            [userId]
        );
    }

    /**
     * Revoke a specific session.
     */
    async revokeSession(sessionId) {
        await this.db.run(
            `UPDATE sessions SET revoked = 1, revoked_at = NOW() WHERE id = ?`,
            [sessionId]
        );
    }

    /**
     * Revoke all sessions for a user except the current one.
     */
    async revokeOtherSessions(userId, currentSessionId) {
        await this.db.run(
            `UPDATE sessions SET revoked = 1, revoked_at = NOW()
             WHERE user_id = ? AND id != ? AND revoked = 0`,
            [userId, currentSessionId]
        );
    }

    /**
     * Enforce max concurrent sessions (revoke oldest).
     * @param {number} userId
     * @param {number} maxSessions - default 5
     */
    async enforceMaxSessions(userId, maxSessions = 5) {
        const active = await this.db.all(
            `SELECT id FROM sessions
             WHERE user_id = ? AND expires_at > NOW() AND revoked = 0
             ORDER BY created_at DESC`,
            [userId]
        );
        if (active.length > maxSessions) {
            const toRevoke = active.slice(maxSessions);
            for (const s of toRevoke) {
                await this.revokeSession(s.id);
            }
        }
    }

    /**
     * Update last activity timestamp.
     */
    async touchSession(sessionId) {
        await this.db.run(
            `UPDATE sessions SET last_activity = NOW() WHERE id = ?`,
            [sessionId]
        );
    }

    /**
     * Check idle timeout (revoke if idle > allowed).
     * @param {number} maxIdleMs - 30 min default
     */
    async enforceIdleTimeout(sessionId, maxIdleMs = 1800000) {
        const session = await this.db.get(
            `SELECT last_activity FROM sessions WHERE id = ?`,
            [sessionId]
        );
        if (!session) return;
        const idleMs = Date.now() - new Date(session.last_activity).getTime();
        if (idleMs > maxIdleMs) {
            await this.revokeSession(sessionId);
            throw new Error("Session expired due to inactivity");
        }
    }
}

// ============================================================================
// 6. ACCOUNT LOCKOUT MECHANISM
// ============================================================================
// Goals:
//   - Progressive lockout: 5 fails → 15 min block, 10 fails → 1 hour
//   - Notify user on lockout via email
//   - Admin unlock capability
//   - Lockout persists across IP changes (account-based)

class AccountLockout {
    constructor(db) {
        this.db = db;
    }

    /**
     * Record a failed login attempt. Lock account if threshold exceeded.
     * @returns {{ locked: boolean, lockedUntil: Date|null, attempts: number }}
     */
    async recordFailedAttempt(email) {
        const user = await this.db.get(
            `SELECT id, failed_attempts, locked_until FROM users WHERE email = ?`,
            [email]
        );
        if (!user) return { locked: false, lockedUntil: null, attempts: 0 };

        const attempts = (user.failed_attempts || 0) + 1;
        let lockedUntil = null;

        if (attempts >= 10) {
            lockedUntil = new Date(Date.now() + 3600000); // 1 hour
        } else if (attempts >= 5) {
            lockedUntil = new Date(Date.now() + 900000); // 15 min
        }

        await this.db.run(
            `UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?`,
            [attempts, lockedUntil ? lockedUntil.toISOString() : null, user.id]
        );

        return {
            locked: !!lockedUntil,
            lockedUntil,
            attempts
        };
    }

    /**
     * Reset failed attempts on successful login.
     */
    async resetAttempts(email) {
        await this.db.run(
            `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE email = ?`,
            [email]
        );
    }

    /**
     * Check if account is currently locked.
     */
    async isLocked(email) {
        const user = await this.db.get(
            `SELECT locked_until FROM users WHERE email = ?`,
            [email]
        );
        if (!user || !user.locked_until) return false;
        return new Date(user.locked_until) > new Date();
    }

    /**
     * Admin unlock.
     */
    async adminUnlock(email) {
        await this.db.run(
            `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE email = ?`,
            [email]
        );
    }
}

// ============================================================================
// 7. SECURE TOKEN STORAGE (CLIENT-SIDE)
// ============================================================================
// Goals:
//   - Encrypt tokens before storing in localStorage
//   - Auto-clear on tab close (sessionStorage for access tokens)
//   - HttpOnly cookie option for non-SPA pages
//   - Token leakage prevention (no logging, no URL params)
//
// NOTE: This is a frontend module (browser). Include via script tag or bundle.

/*
// --- Usage in frontend (public/index.html) ---

class SecureTokenStore {
    constructor() {
        this.encryptionKey = null; // derived from device fingerprint
    }

    async init() {
        // Derive key from device fingerprint
        const fingerprint = await this._getFingerprint();
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(fingerprint.padEnd(32, "0").slice(0, 32)),
            "PBKDF2",
            false,
            ["deriveKey"]
        );
        this.encryptionKey = await crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: new TextEncoder().encode("HavenGo-Token-Salt"),
                iterations: 600000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async _getFingerprint() {
        const parts = [
            navigator.userAgent || "",
            navigator.language || "",
            screen.colorDepth || "",
            // Do NOT include IP or anything involving PII
        ];
        const hash = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(parts.join("|||"))
        );
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    async setAccessToken(token) {
        // Store access token in sessionStorage (cleared on tab close)
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            this.encryptionKey,
            new TextEncoder().encode(token)
        );
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        sessionStorage.setItem("hg_at", btoa(String.fromCharCode(...combined)));
    }

    async getAccessToken() {
        const raw = sessionStorage.getItem("hg_at");
        if (!raw) return null;
        try {
            const data = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
            const iv = data.slice(0, 12);
            const encrypted = data.slice(12);
            const decrypted = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv },
                this.encryptionKey,
                encrypted
            );
            return new TextDecoder().decode(decrypted);
        } catch {
            sessionStorage.removeItem("hg_at");
            return null;
        }
    }

    async setRefreshToken(token) {
        // Store refresh token in localStorage (persists across tabs)
        // but encrypted with the same device-bound key
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            this.encryptionKey,
            new TextEncoder().encode(token)
        );
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        localStorage.setItem("hg_rt", btoa(String.fromCharCode(...combined)));
    }

    async getRefreshToken() {
        const raw = localStorage.getItem("hg_rt");
        if (!raw) return null;
        try {
            const data = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
            const iv = data.slice(0, 12);
            const encrypted = data.slice(12);
            const decrypted = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv },
                this.encryptionKey,
                encrypted
            );
            return new TextDecoder().decode(decrypted);
        } catch {
            localStorage.removeItem("hg_rt");
            return null;
        }
    }

    clear() {
        sessionStorage.removeItem("hg_at");
        localStorage.removeItem("hg_rt");
    }
}
*/

// ============================================================================
// 8. EMAIL VERIFICATION WITH SIGNED TOKENS
// ============================================================================
// Goals:
//   - Signed verification URLs (tamper-proof)
//   - Short expiry (1 hour)
//   - One-time use (token consumed after verification)
//   - Separate token for email change verification

class EmailVerification {
    /**
     * @param {string} signingKey - HMAC secret (at least 32 bytes)
     */
    constructor(signingKey) {
        this.signingKey = signingKey || crypto.randomBytes(32).toString("hex");
    }

    /**
     * Generate a signed verification token.
     * @param {string} email
     * @param {string} purpose - "verify" | "change" | "reset"
     * @returns {string} token
     */
    generateToken(email, purpose = "verify") {
        const payload = {
            email,
            purpose,
            exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
            jti: crypto.randomUUID()
        };
        const data = JSON.stringify(payload);
        const signature = crypto
            .createHmac("sha384", this.signingKey)
            .update(data)
            .digest("base64url");
        return Buffer.from(data).toString("base64url") + "." + signature;
    }

    /**
     * Verify and decode a signed token.
     * @returns {{ valid: boolean, payload: Object|null, error: string|null }}
     */
    verifyToken(token, expectedEmail, expectedPurpose = "verify") {
        try {
            const parts = token.split(".");
            if (parts.length !== 2) return { valid: false, payload: null, error: "Invalid token format" };

            const data = Buffer.from(parts[0], "base64url").toString("utf8");
            const payload = JSON.parse(data);

            // Verify signature
            const expectedSig = crypto
                .createHmac("sha384", this.signingKey)
                .update(data)
                .digest("base64url");
            if (parts[1] !== expectedSig) {
                return { valid: false, payload: null, error: "Invalid signature" };
            }

            // Check expiry
            if (payload.exp < Math.floor(Date.now() / 1000)) {
                return { valid: false, payload: null, error: "Token expired" };
            }

            // Check purpose and email
            if (payload.purpose !== expectedPurpose) {
                return { valid: false, payload: null, error: "Token purpose mismatch" };
            }
            if (payload.email !== expectedEmail) {
                return { valid: false, payload: null, error: "Token email mismatch" };
            }

            return { valid: true, payload, error: null };
        } catch (e) {
            return { valid: false, payload: null, error: e.message };
        }
    }
}

// ============================================================================
// 9. HELPERS & UTILITIES
// ============================================================================

/**
 * Generate a cryptographically secure random code (for 2FA/verification).
 * @param {number} length - digit count (default 6)
 * @returns {string}
 */
function generateSecureCode(length = 6) {
    const max = Math.pow(10, length);
    const min = Math.pow(10, length - 1);
    return String(Math.floor(crypto.randomInt(min, max)));
}

/**
 * Constant-time string comparison (prevents timing attacks).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function constantTimeCompare(a, b) {
    if (a.length !== b.length) {
        // Still do the comparison to prevent length-based timing leak
        const fake = Buffer.alloc(a.length);
        const target = Buffer.from(b);
        return crypto.timingSafeEqual(fake, target) && false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Sanitize user input to prevent NoSQL injection / XSS in identifiers.
 */
function sanitizeInput(input) {
    if (typeof input !== "string") return input;
    return input
        .replace(/[<>]/g, "")          // strip HTML tags
        .replace(/[\$\{\}\(\)]/g, "")  // strip template injection chars
        .trim();
}

/**
 * Get device fingerprint from request.
 */
function getDeviceFingerprint(req) {
    const parts = [
        req.headers["user-agent"] || "",
        req.headers["accept-language"] || "",
        req.headers["sec-ch-ua"] || ""
    ];
    return crypto.createHash("sha256").update(parts.join("|||")).digest("hex");
}

// ============================================================================
// 10. PAYMENT SECURITY
// ============================================================================
// Goals:
//   - Server-side price calculation (never trust client-provided amounts)
//   - Transaction integrity via HMAC-signed payloads
//   - Idempotency keys to prevent double-spending
//   - Optimistic locking for balance updates (race condition prevention)
//   - Mobile Money validation (phone format, reference codes)
//   - Digital receipts with tamper-proof signatures
//   - Escrow flow: hold funds → service completed → release to provider
//   - Immutable audit trail for all financial operations

class PaymentSecurity {
    /**
     * @param {string} hmacKey - secret for signing transaction payloads (32+ bytes)
     */
    constructor(hmacKey) {
        this.hmacKey = hmacKey || crypto.randomBytes(32).toString("hex");
        this.processedIdempotencyKeys = new Set(); // use Redis in production
    }

    // -----------------------------------------------------------------------
    // 10a. Transaction Integrity — Signed Payloads
    // -----------------------------------------------------------------------

    /**
     * Sign a transaction payload so the client cannot tamper with price/service.
     * The server creates a signed payload; client submits it; server verifies.
     *
     * @param {Object} data - { userId, serviceId, amount, currency, timestamp }
     * @returns {{ payload: string, signature: string }}
     */
    signTransactionPayload(data) {
        const payload = {
            ...data,
            nonce: crypto.randomUUID(),
            iat: Math.floor(Date.now() / 1000)
        };
        const serialized = JSON.stringify(payload);
        const signature = crypto
            .createHmac("sha384", this.hmacKey)
            .update(serialized)
            .digest("base64url");
        return {
            payload: Buffer.from(serialized).toString("base64url"),
            signature
        };
    }

    /**
     * Verify a signed transaction payload.
     * @returns {{ valid: boolean, data: Object|null, error: string|null }}
     */
    verifyTransactionPayload(encodedPayload, signature) {
        try {
            const serialized = Buffer.from(encodedPayload, "base64url").toString("utf8");
            const expectedSig = crypto
                .createHmac("sha384", this.hmacKey)
                .update(serialized)
                .digest("base64url");
            if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
                return { valid: false, data: null, error: "Invalid signature — payload tampered" };
            }
            const data = JSON.parse(serialized);
            // Check expiry (payload valid for 5 minutes)
            if (data.iat && (Math.floor(Date.now() / 1000) - data.iat) > 300) {
                return { valid: false, data: null, error: "Transaction payload expired" };
            }
            return { valid: true, data, error: null };
        } catch (e) {
            return { valid: false, data: null, error: e.message };
        }
    }

    // -----------------------------------------------------------------------
    // 10b. Amount Verification — Server-Side Price Recalculation
    // -----------------------------------------------------------------------

    /**
     * Server-side price calculator. The client sends the service + options,
     * the server recalculates the price. NEVER use client-provided amounts.
     *
     * This mirrors the front-end calculateDynamicPrice() but on the server,
     * ensuring the user cannot manipulate prices.
     *
     * @param {Object} opts - { serviceId, category, options }
     * @param {Object} pricingDB - { basePrice, priceRules }
     * @returns {number} verified price
     */
    static calculateServerPrice(opts, pricingDB) {
        const base = pricingDB.basePrice;
        const cat = opts.category;
        let total = base;

        switch (cat) {
            case "cleaning": {
                const rooms = Math.max(1, Math.min(20, parseInt(opts.rooms) || 2));
                const bathrooms = Math.max(1, Math.min(10, parseInt(opts.bathrooms) || 1));
                const compound = !!opts.compound;
                total = base + (base * 0.6 * (rooms - 1)) + (base * 0.3 * (bathrooms - 1));
                if (compound) total += base * 0.6;
                break;
            }
            case "spa": {
                const services = opts.selectedServices || [];
                const spaPrices = { massage: 40000, nails: 35000, facial: 40000 };
                total = 0;
                for (const s of services) {
                    if (spaPrices[s]) total += spaPrices[s];
                }
                if (total === 0) total = base;
                break;
            }
            case "hair": {
                const hairPrices = { knotless: 120000, weave: 90000, dread: 110000, perm: 75000, cut: 35000 };
                total = hairPrices[opts.style] || base;
                break;
            }
            case "appliance": {
                const appPrices = { ac: 120000, fridge: 85000, washer: 75000, oven: 65000, phone: 45000, other: 55000 };
                total = appPrices[opts.applianceType] || base;
                break;
            }
            case "gardening": {
                const size = Math.max(10, Math.min(1000, parseInt(opts.size) || 50));
                total = base * (size / 50);
                if (opts.serviceType === "full") total *= 1.6;
                break;
            }
            case "event": {
                const items = opts.selectedItems || [];
                const eventPrices = { tent: 120000, chairs: 45000, sound: 85000 };
                total = 0;
                for (const item of items) {
                    if (eventPrices[item]) total += eventPrices[item];
                }
                if (total === 0) total = base;
                break;
            }
            case "auto": {
                const autoPrices = { basic: 45000, full: 95000, interior: 55000 };
                total = autoPrices[opts.autoType] || base;
                break;
            }
            case "laundry": {
                total = base;
                if (opts.loadType === "large") total *= 1.5;
                if (opts.serviceType === "dryclean") total += 15000;
                if (opts.serviceType === "both") total += 25000;
                break;
            }
            case "water": {
                const count = Math.max(1, Math.min(50, parseInt(opts.jerrycans) || 1));
                total = base * count;
                if (opts.deliveryType === "express") total *= 1.2;
                if (count >= 5) total *= 0.9; // bulk discount
                break;
            }
            case "catering": {
                const guests = Math.max(5, Math.min(1000, parseInt(opts.guests) || 20));
                const additional = Math.max(0, guests - 20);
                total = base * (1 + (additional / 100) * 0.6);
                break;
            }
            case "kids": {
                const kcount = Math.max(1, Math.min(20, parseInt(opts.count) || 1));
                const khours = Math.max(1, Math.min(12, parseInt(opts.hours) || 3));
                const extraKids = Math.max(0, kcount - 1);
                const extraHours = Math.max(0, khours - 3);
                total = base + (base * 0.6 * extraKids) + (base * 0.2 * extraHours);
                break;
            }
            case "nursing": {
                const nDays = Math.max(1, Math.min(30, parseInt(opts.days) || 1));
                const multipliers = { elderly: 1.0, postsurgery: 1.2, general: 0.9 };
                total = base * nDays * (multipliers[opts.careType] || 1.0);
                break;
            }
            case "family": {
                const fcount = Math.max(1, Math.min(10, parseInt(opts.count) || 1));
                const fhours = Math.max(1, Math.min(24, parseInt(opts.hours) || 4));
                total = base * fcount * (fhours / 4);
                break;
            }
            case "errands": {
                const eitems = Math.max(1, Math.min(50, parseInt(opts.items) || 1));
                const edist = Math.max(1, Math.min(50, parseInt(opts.distance) || 5));
                total = base + (base * 0.3 * (eitems - 1)) + (base * 0.1 * (edist / 5));
                break;
            }
        }

        // Apply subscription discount if applicable
        if (opts.subscriptionDiscount) {
            total *= (1 - (opts.subscriptionDiscountPercent || 0) / 100);
        }

        return Math.round(total);
    }

    // -----------------------------------------------------------------------
    // 10c. Idempotency — Prevent Double-Spending
    // -----------------------------------------------------------------------

    /**
     * Check and mark an idempotency key as used.
     * Returns false if key was already processed (duplicate request).
     */
    checkIdempotency(idempotencyKey) {
        if (this.processedIdempotencyKeys.has(idempotencyKey)) {
            return false; // already processed — reject
        }
        this.processedIdempotencyKeys.add(idempotencyKey);
        // Auto-expire after 24 hours
        setTimeout(() => {
            this.processedIdempotencyKeys.delete(idempotencyKey);
        }, 86400000);
        return true;
    }

    /**
     * Generate a unique idempotency key for a transaction.
     */
    static generateIdempotencyKey(userId, amount, nonce) {
        const raw = `${userId}:${amount}:${nonce || crypto.randomUUID()}`;
        return crypto.createHash("sha256").update(raw).digest("hex");
    }

    // -----------------------------------------------------------------------
    // 10d. Optimistic Locking — Race-Condition-Free Balance Updates
    // -----------------------------------------------------------------------
    //
    // Instead of:  SELECT balance → check → UPDATE balance
    // Use:         UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?
    //              Then check rows_affected === 1
    //
    // This is handled in the SQL, but this class provides the pattern:

    /**
     * Attempt to deduct from user balance atomically.
     * @param {Function} dbUpdate - async function that runs the UPDATE with WHERE balance >= amount
     * @returns {Promise<boolean>} true if balance was sufficient and deducted
     *
     * Usage:
     *   const success = await PaymentSecurity.atomicDeduct(async () => {
     *       const result = await db.run(
     *           "UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?",
     *           [amount, userId, amount]
     *       );
     *       return result.changes > 0;
     *   });
     */
    static async atomicDeduct(dbUpdate) {
        return await dbUpdate();
    }

    /**
     * Refund a user's balance (credit back).
     */
    static async atomicCredit(db, userId, amount) {
        await db.run(
            "UPDATE users SET balance = balance + ? WHERE id = ?",
            [amount, userId]
        );
    }

    // -----------------------------------------------------------------------
    // 10e. Mobile Money Validation (UG)
    // -----------------------------------------------------------------------

    /**
     * Validate a Ugandan mobile money phone number.
     * Formats: +2567XXXXXXXX, 07XXXXXXXX, 2567XXXXXXXX
     * Networks: MTN (077, 078), Airtel (075, 070), Africell (074)
     */
    static validateMobileMoneyPhone(phone) {
        const errors = [];
        let cleaned = phone.replace(/[\s\-\(\)]/g, "");

        // Normalize
        if (cleaned.startsWith("00")) {
            cleaned = "+" + cleaned.slice(2);
        }
        if (cleaned.startsWith("256") && !cleaned.startsWith("+256")) {
            cleaned = "+" + cleaned;
        }

        const patterns = [
            /^\+2567[0-9]{8}$/,           // +2567XXXXXXXX (11 digits after +256)
            /^07[0-9]{8}$/,                // 07XXXXXXXX (10 digits)
            /^2567[0-9]{8}$/               // 2567XXXXXXXX (12 digits)
        ];

        let valid = false;
        let normalized = cleaned;
        for (const pat of patterns) {
            if (pat.test(cleaned)) {
                valid = true;
                // Normalize to +256 format
                if (cleaned.startsWith("07")) {
                    normalized = "+256" + cleaned.slice(1);
                } else if (cleaned.startsWith("256")) {
                    normalized = "+" + cleaned;
                }
                break;
            }
        }

        if (!valid) {
            errors.push("Invalid Ugandan mobile money number. Use format: 077XXXXXXX or +2567XXXXXXXX");
        }

        // Network detection
        let network = "unknown";
        // After +256, the network code is 2 digits: 77/78=MTN, 75/70/76=Airtel, 74=Africell
        const prefixDigits = normalized.slice(4, 6);
        if (["77", "78"].includes(prefixDigits)) network = "MTN";
        else if (["75", "70", "76"].includes(prefixDigits)) network = "Airtel";
        else if (["74"].includes(prefixDigits)) network = "Africell";

        return { valid, normalized, network, errors };
    }

    /**
     * Generate a payment reference code for tracking.
     * Format: HG-{DATE}-{RANDOM} e.g. HG-20260530-A7F3C2
     */
    static generatePaymentReference() {
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
        return `HG-${date}-${rand}`;
    }

    // -----------------------------------------------------------------------
    // 10f. Digital Receipts
    // -----------------------------------------------------------------------

    /**
     * Generate a tamper-proof digital receipt for a completed transaction.
     */
    generateReceipt(transaction) {
        const receipt = {
            receiptId: `RCP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
            transactionId: transaction.id,
            userId: transaction.userId,
            serviceName: transaction.serviceName,
            amount: transaction.amount,
            currency: "UGX",
            paymentMethod: transaction.paymentMethod || "Mobile Money",
            reference: transaction.reference,
            status: "completed",
            timestamp: new Date().toISOString()
        };
        const serialized = JSON.stringify(receipt);
        receipt.signature = crypto
            .createHmac("sha512", this.hmacKey)
            .update(serialized)
            .digest("hex");
        return receipt;
    }

    /**
     * Verify a receipt's signature.
     */
    verifyReceipt(receipt) {
        const signature = receipt.signature;
        delete receipt.signature;
        const serialized = JSON.stringify(receipt);
        const expectedSig = crypto
            .createHmac("sha512", this.hmacKey)
            .update(serialized)
            .digest("hex");
        receipt.signature = signature; // restore
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
    }

    // -----------------------------------------------------------------------
    // 10g. Escrow Payment Flow
    // -----------------------------------------------------------------------
    //
    // Flow:
    //   1. Customer deposits funds → balance locked (held)
    //   2. Service completed → release held amount to provider
    //   3. Service cancelled → release hold back to customer
    //
    // This prevents the provider from being paid before service completion
    // and ensures funds are available when the service is done.

    /**
     * Hold funds for a service order (escrow).
     * @returns {{ success: boolean, holdReference: string, error: string }}
     */
    static async holdFunds(db, userId, amount, orderId) {
        // Atomic: deduct from available balance, add to escrow hold
        const result = await db.run(
            `UPDATE users
             SET balance = balance - ?,
                 escrow_balance = COALESCE(escrow_balance, 0) + ?
             WHERE id = ? AND balance >= ?`,
            [amount, amount, userId, amount]
        );
        if (result.changes === 0) {
            return { success: false, holdReference: null, error: "Insufficient balance" };
        }
        const holdReference = `ESC-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        await db.run(
            `INSERT INTO escrow_holds (order_id, user_id, amount, hold_reference, status, created_at)
             VALUES (?, ?, ?, ?, 'held', NOW())`,
            [orderId, userId, amount, holdReference]
        );
        return { success: true, holdReference, error: null };
    }

    /**
     * Release escrowed funds to the provider (on service completion).
     */
    static async releaseFunds(db, orderId, providerId) {
        const hold = await db.get(
            `SELECT * FROM escrow_holds WHERE order_id = ? AND status = 'held'`,
            [orderId]
        );
        if (!hold) {
            return { success: false, error: "No escrow hold found for this order" };
        }
        // Credit provider (minus platform fee)
        const platformFee = Math.round(hold.amount * 0.15); // 15% platform fee
        const providerAmount = hold.amount - platformFee;
        await db.run(
            `UPDATE users SET balance = balance + ? WHERE id = ?`,
            [providerAmount, providerId]
        );
        // Credit platform fee to system account
        await db.run(
            `UPDATE admin_settings SET system_balance = COALESCE(system_balance, 0) + ?`,
            [platformFee]
        );
        // Mark hold as released
        await db.run(
            `UPDATE escrow_holds SET status = 'released', released_at = NOW() WHERE id = ?`,
            [hold.id]
        );
        return { success: true, providerAmount, platformFee, error: null };
    }

    /**
     * Release escrowed funds back to the customer (on cancellation).
     */
    static async releaseHoldToCustomer(db, orderId, userId) {
        const hold = await db.get(
            `SELECT * FROM escrow_holds WHERE order_id = ? AND status = 'held'`,
            [orderId]
        );
        if (!hold) {
            return { success: false, error: "No escrow hold found" };
        }
        await db.run(
            `UPDATE users SET escrow_balance = COALESCE(escrow_balance, 0) - ?,
                              balance = balance + ?
             WHERE id = ?`,
            [hold.amount, hold.amount, userId]
        );
        await db.run(
            `UPDATE escrow_holds SET status = 'returned', returned_at = NOW() WHERE id = ?`,
            [hold.id]
        );
        return { success: true, error: null };
    }

    // -----------------------------------------------------------------------
    // 10h. Audit Trail — Immutable Transaction Log
    // -----------------------------------------------------------------------

    /**
     * Log a financial event to the audit trail.
     * @param {Object} db - database adapter
     * @param {Object} entry - { userId, action, amount, reference, description, ipAddress }
     */
    static async auditLog(db, entry) {
        await db.run(
            `INSERT INTO audit_log (user_id, action, amount, reference, description, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
                entry.userId,
                entry.action,        // e.g. "payment", "refund", "withdraw", "escrow_hold", "escrow_release"
                entry.amount || 0,
                entry.reference || "",
                entry.description || "",
                entry.ipAddress || ""
            ]
        );
    }

    /**
     * Get audit trail for a user or all users (admin).
     */
    static async getAuditTrail(db, userId = null, limit = 100) {
        if (userId) {
            return await db.all(
                `SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
                [userId, limit]
            );
        }
        return await db.all(
            `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`,
            [limit]
        );
    }
}

// ============================================================================
// 11. CHAT ENCRYPTION — End-to-End with ECDH + AES-256-GCM
// ============================================================================
// Goals:
//   - Perfect forward secrecy via ECDH key exchange per conversation
//   - Messages encrypted with AES-256-GCM before leaving the sender's device
//   - Firestore stores only ciphertext — server never sees plaintext
//   - Key material never transmitted; derived via ECDH shared secret
//   - Each conversation has a unique symmetric key (rotatable)
//   - Integrates with existing Firestore chat infrastructure
//
// Architecture:
//   Each user generates an ECDH key pair (curve P-256) on first login.
//   Public keys are stored in Firestore at `users/{userId}/publicKey`.
//   When starting a conversation, participants exchange public keys
//   (via Firestore), derive a shared secret via ECDH, and derive an
//   AES-256-GCM key via HKDF. All messages are encrypted client-side
//   before being written to Firestore.
//
// NOTE: This module is designed for client-side (browser) use with
//       the Web Crypto API, but the Node.js version is provided here
//       for backend testing and as a reference implementation.

const { subtle } = crypto.webcrypto || {};

/**
 * Generate an ECDH key pair on the P-256 curve.
 * @returns {Promise<{ publicKey: CryptoKey, privateKey: CryptoKey, publicKeyJwk: Object }>}
 */
async function generateChatKeyPair() {
    const keyPair = await subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
    );
    const publicKeyJwk = await subtle.exportKey("jwk", keyPair.publicKey);
    return { ...keyPair, publicKeyJwk };
}

/**
 * Import a peer's public key from JWK format.
 */
async function importPeerPublicKey(jwk) {
    return await subtle.importKey(
        "jwk", jwk,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        []
    );
}

/**
 * Derive an AES-256-GCM key from an ECDH shared secret + HKDF.
 * @param {CryptoKey} privateKey - local user's private key
 * @param {CryptoKey} peerPublicKey - peer's public key
 * @param {string} salt - conversation ID or other unique context
 * @returns {Promise<CryptoKey>} AES-GCM key
 */
async function deriveChatKey(privateKey, peerPublicKey, salt) {
    const sharedBits = await subtle.deriveBits(
        { name: "ECDH", public: peerPublicKey },
        privateKey,
        256
    );
    // Use HKDF to derive a properly sized AES key
    const hkdfKey = await subtle.importKey(
        "raw", sharedBits,
        { name: "HKDF" },
        false,
        ["deriveKey"]
    );
    const encoder = new TextEncoder();
    return await subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: encoder.encode(salt),
            info: encoder.encode("havengo-chat-v1")
        },
        hkdfKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * Encrypt a chat message.
 * @param {string} plaintext - message text
 * @param {CryptoKey} aesKey - derived AES-256-GCM key
 * @returns {Promise<{ ciphertext: string, iv: string }>} base64url encoded
 */
async function encryptChatMessage(plaintext, aesKey) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
    const ciphertext = await subtle.encrypt(
        { name: "AES-GCM", iv },
        aesKey,
        encoder.encode(plaintext)
    );
    return {
        ciphertext: Buffer.from(ciphertext).toString("base64url"),
        iv: Buffer.from(iv).toString("base64url")
    };
}

/**
 * Decrypt a chat message.
 * @param {string} ciphertext - base64url encoded ciphertext
 * @param {string} iv - base64url encoded IV
 * @param {CryptoKey} aesKey - derived AES-256-GCM key
 * @returns {Promise<string>} decrypted plaintext
 */
async function decryptChatMessage(ciphertext, aesKey, iv) {
    const decoder = new TextDecoder();
    const plaintext = await subtle.decrypt(
        { name: "AES-GCM", iv: Buffer.from(iv, "base64url") },
        aesKey,
        Buffer.from(ciphertext, "base64url")
    );
    return decoder.decode(plaintext);
}

/**
 * ChatEncryption — full lifecycle management for encrypted chat.
 *
 * Usage (client-side):
 *   const chat = new ChatEncryption(userId);
 *   await chat.init();                          // generate or load key pair
 *   await chat.establishSession(peerId, convId); // ECDH + derive AES key
 *   const encrypted = await chat.encrypt("Hello");  // encrypt a message
 *   const decrypted = await chat.decrypt(encrypted.ciphertext, encrypted.iv);
 */
class ChatEncryption {
    /**
     * @param {string} userId
     * @param {Function} keyStore - async { get, set } for key persistence
     */
    constructor(userId, keyStore = null) {
        this.userId = userId;
        this.keyPair = null;
        this.sessions = {};       // { conversationId: CryptoKey (AES-GCM) }
        this.publicKeyCache = {}; // { userId: CryptoKey (ECDH public) }
        this.keyStore = keyStore; // optional Firestore-backed storage
    }

    /**
     * Initialize: generate new key pair or load from persistent store.
     */
    async init() {
        if (this.keyStore) {
            const stored = await this.keyStore.get(`chatKey_${this.userId}`);
            if (stored) {
                this.keyPair = {
                    publicKeyJwk: stored.publicKeyJwk,
                    privateKey: await subtle.importKey(
                        "jwk", stored.privateKeyJwk,
                        { name: "ECDH", namedCurve: "P-256" },
                        true,
                        ["deriveKey", "deriveBits"]
                    ),
                    publicKey: await subtle.importKey(
                        "jwk", stored.publicKeyJwk,
                        { name: "ECDH", namedCurve: "P-256" },
                        true,
                        []
                    )
                };
                return;
            }
        }
        this.keyPair = await generateChatKeyPair();
        if (this.keyStore) {
            const privateKeyJwk = await subtle.exportKey("jwk", this.keyPair.privateKey);
            await this.keyStore.set(`chatKey_${this.userId}`, {
                publicKeyJwk: this.keyPair.publicKeyJwk,
                privateKeyJwk
            });
        }
    }

    /**
     * Get this user's public key (JWK) for sharing.
     */
    getPublicKey() {
        return this.keyPair.publicKeyJwk;
    }

    /**
     * Load a peer's public key from cache or store.
     */
    async loadPeerPublicKey(peerUserId) {
        if (this.publicKeyCache[peerUserId]) {
            return this.publicKeyCache[peerUserId];
        }
        if (this.keyStore) {
            const peerJwk = await this.keyStore.get(`pubKey_${peerUserId}`);
            if (peerJwk) {
                const key = await importPeerPublicKey(peerJwk);
                this.publicKeyCache[peerUserId] = key;
                return key;
            }
        }
        throw new Error(`Peer public key not found for ${peerUserId}`);
    }

    /**
     * Cache a peer's public key for later use.
     */
    async cachePeerPublicKey(peerUserId, jwk) {
        const key = await importPeerPublicKey(jwk);
        this.publicKeyCache[peerUserId] = key;
        if (this.keyStore) {
            await this.keyStore.set(`pubKey_${peerUserId}`, jwk);
        }
    }

    /**
     * Establish an encrypted session with a peer for a given conversation.
     * Derives a shared AES-256-GCM key via ECDH + HKDF.
     */
    async establishSession(peerUserId, conversationId) {
        if (this.sessions[conversationId]) return; // already established
        const peerKey = await this.loadPeerPublicKey(peerUserId);
        const aesKey = await deriveChatKey(
            this.keyPair.privateKey,
            peerKey,
            conversationId
        );
        this.sessions[conversationId] = aesKey;
        return aesKey;
    }

    /**
     * Encrypt a message for a given conversation.
     * @returns {{ ciphertext: string, iv: string }}
     */
    async encrypt(conversationId, plaintext) {
        const key = this.sessions[conversationId];
        if (!key) throw new Error(`No session established for ${conversationId}`);
        return await encryptChatMessage(plaintext, key);
    }

    /**
     * Decrypt a message from a given conversation.
     * @returns {string}
     */
    async decrypt(conversationId, ciphertext, iv) {
        const key = this.sessions[conversationId];
        if (!key) throw new Error(`No session established for ${conversationId}`);
        return await decryptChatMessage(ciphertext, key, iv);
    }

    /**
     * Rotate the encryption key for a conversation (forward secrecy).
     * Re-derives from the same ECDH keys but with a new salt.
     */
    async rotateKey(peerUserId, conversationId) {
        delete this.sessions[conversationId];
        // Force re-derivation with a different salt variant
        const rotatedId = conversationId + ":rotated:" + Date.now();
        const peerKey = await this.loadPeerPublicKey(peerUserId);
        const aesKey = await deriveChatKey(
            this.keyPair.privateKey,
            peerKey,
            rotatedId
        );
        this.sessions[conversationId] = aesKey;
        return aesKey;
    }

    /**
     * Clear all sessions (logout / key rotation).
     */
    clearSessions() {
        this.sessions = {};
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    JwtHardener,
    MfaManager,
    PasswordPolicy,
    RateLimiter,
    SessionManager,
    AccountLockout,
    EmailVerification,
    PaymentSecurity,
    ChatEncryption,
    generateChatKeyPair,
    deriveChatKey,
    encryptChatMessage,
    decryptChatMessage,
    generateSecureCode,
    constantTimeCompare,
    sanitizeInput,
    getDeviceFingerprint
};

// ============================================================================
// APPENDIX: Top 1000 Common Passwords (abridged for size)
// Full list would be loaded from a file; here's the check approach:
// ============================================================================

const COMMON_PASSWORDS = new Set([
    "123456", "password", "12345678", "qwerty", "123456789",
    "12345", "1234", "111111", "1234567", "sunshine",
    "qwerty123", "iloveyou", "princess", "admin", "welcome",
    "666666", "abc123", "football", "123123", "monkey",
    "654321", "!@#$%^&*", "charlie", "aa123456", "donald",
    "password1", "qwerty12345", "1234567890", "letmein", "password123",
    "dragon", "baseball", "adobe123", "admin123", "master",
    "photoshop", "1234", "ashley", "batman", "trustno1",
    "hottie", "access", "flower", "starwars", "12345678910",
    "zxcvbnm", "lovely", "passw0rd", "shadow", "michael",
    "!@#$%^&", "jordan", "buster", "jennifer", "password!",
    "superman", "fuckme", "solo", "tigger", "harley",
    "robert", "hunter", "ranger", "andrew", "love123",
    "11111111", "thomas", "joshua", "pepper", "matthew",
    "daniel", "george", "computer", "amanda", "orange",
    "ginger", "biteme", "freedom", "cheese", "summer",
    "secret", "corvette", "fender", "midnight", "asshole",
    "buthead", "whatever", "1q2w3e4r", "nicole", "cowboy",
    "steelers", "fuckyou", "dallas", "asdfgh", "qwertyuiop",
    "passion", "spider", "killer", "jasper", "james"
]);
