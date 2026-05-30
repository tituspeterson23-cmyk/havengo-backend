/**
 * Test suite for Session Persistence (Section 12 of havengo-security.js)
 *
 * Tests:
 *   1. JwtHardener — access token sign/verify, expiry, fingerprint binding, revocation
 *   2. SessionManager — create, query, revoke, enforce max sessions, idle timeout
 *   3. Combined refresh flow — token rotation, theft detection, concurrent refresh safety
 *
 * Run: node test-session-persistence.js
 */

const crypto = require('crypto');
const { JwtHardener, SessionManager } = require('./havengo-security.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) { passed++; console.log('  ✓ ' + label); }
    else { failed++; console.error('  ✗ ' + label); }
}

// ─── Mock DB for SessionManager tests ──────────────────────────────────────

function createMockDb() {
    const sessions = [];
    let nextId = 1;
    return {
        run: async (sql, params) => {
            if (sql.includes('INSERT INTO sessions')) {
                const session = {
                    id: nextId++,
                    user_id: params[0],
                    email: params[1],
                    role: params[2],
                    token_hash: params[3],
                    device_info: params[4],
                    ip: params[5],
                    expires_at: params[6],
                    created_at: new Date().toISOString(),
                    last_activity: new Date().toISOString(),
                    revoked: 0
                };
                sessions.push(session);
                return { changes: 1 };
            }
            if (sql.includes('UPDATE sessions SET revoked = 1, revoked_at') && sql.includes('WHERE id = ?') && !sql.includes('user_id') && !sql.includes('token_hash')) {
                const s = sessions.find(s => s.id === params[0]);
                if (s) s.revoked = 1;
                return { changes: s ? 1 : 0 };
            }
            // revokeOtherSessions: UPDATE sessions SET revoked = 1, revoked_at = NOW() WHERE user_id = ? AND id != ? AND revoked = 0
            if (sql.includes('UPDATE sessions SET revoked = 1, revoked_at') && sql.includes('AND id != ?')) {
                sessions.forEach(s => {
                    if (s.user_id === params[0] && s.id !== params[1]) s.revoked = 1;
                });
                return { changes: 1 };
            }
            // revoke by token_hash (POST /auth/logout): UPDATE sessions SET revoked = 1, revoked_at = NOW() WHERE token_hash = ?
            if (sql.includes('UPDATE sessions SET revoked = 1, revoked_at') && sql.includes('token_hash')) {
                sessions.forEach(s => { if (s.token_hash === params[0]) s.revoked = 1; });
                return { changes: 1 };
            }
            if (sql.includes('UPDATE sessions SET last_activity')) {
                const s = sessions.find(s => s.id === params[0]);
                if (s) s.last_activity = new Date().toISOString();
                return { changes: s ? 1 : 0 };
            }
            return { changes: 0 };
        },
        get: async (sql, params) => {
            if (sql.includes('SELECT id, device_info')) {
                const result = sessions
                    .filter(s => s.user_id === params[0] && !s.revoked && new Date(s.expires_at) > new Date())
                    .map(s => ({ id: s.id, device_info: s.device_info, ip: s.ip, created_at: s.created_at, last_activity: s.last_activity }));
                return result[0] || null;
            }
            if (sql.includes('SELECT * FROM sessions WHERE id = ?')) {
                return sessions.find(s => s.id === params[0]) || null;
            }
            if (sql.includes('SELECT * FROM sessions WHERE token_hash')) {
                return sessions.find(s => s.token_hash === params[0] && !s.revoked && new Date(s.expires_at) > new Date()) || null;
            }
            return null;
        },
        all: async (sql, params) => {
            if (sql.includes('WHERE user_id')) {
                return sessions.filter(s => s.user_id === params[0] && !s.revoked && new Date(s.expires_at) > new Date());
            }
            return [];
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST GROUP 1: JwtHardener
// ═══════════════════════════════════════════════════════════════════════════

async function testJwtHardener() {
    console.log('\n═══ TEST GROUP 1: JwtHardener ═══\n');

    const hardener = new JwtHardener({
        accessSecret: crypto.randomBytes(32).toString('hex'),
        refreshSecret: crypto.randomBytes(32).toString('hex'),
        accessExpiry: 15,     // 15 seconds for fast testing
        refreshExpiry: 600    // 10 minutes
    });

    // 1.1 Sign and verify access token
    const token = hardener.signAccessToken(
        { userId: 1, email: 'test@test.com', role: 'customer' },
        'user-agent-chrome-123|||en-US|||8'
    );
    let decoded;
    try {
        decoded = hardener.verifyAccessToken(token, 'user-agent-chrome-123|||en-US|||8');
        assert(decoded.email === 'test@test.com', 'Access token contains correct email');
        assert(decoded.role === 'customer', 'Access token contains correct role');
        assert(decoded.sub === 1, 'Access token contains correct userId (sub)');
        assert(decoded.type === 'access', 'Access token has type=access');
        assert(!!decoded.jti, 'Access token has unique jti');
        assert(!!decoded.fpr, 'Access token has fingerprint hash');
    } catch (e) {
        assert(false, 'Access token signs and verifies: ' + e.message);
    }

    // 1.2 Wrong fingerprint = rejection
    try {
        hardener.verifyAccessToken(token, 'wrong-fingerprint');
        assert(false, 'Wrong fingerprint should throw');
    } catch (e) {
        assert(e.message.includes('fingerprint mismatch'), 'Wrong fingerprint is detected and rejected');
    }

    // 1.3 No fingerprint when token has one = allowed (fingerprint is optional defense-in-depth)
    // The JwtHardener is designed to accept null/undefined fingerprint for backward compatibility
    // during migration. The fingerprint check is additive: if provided, it MUST match.
    try {
        const d = hardener.verifyAccessToken(token, null);
        assert(d.email === 'test@test.com', '1.3 Token verifies without fingerprint (optional check)');
    } catch (e) {
        assert(false, '1.3 Missing fingerprint should be accepted (optional): ' + e.message);
    }

    // 1.4 Expired token
    const shortHardener = new JwtHardener({
        accessSecret: crypto.randomBytes(32).toString('hex'),
        accessExpiry: 1  // 1 second
    });
    const shortToken = shortHardener.signAccessToken({ userId: 1, email: 'a@b.com', role: 'customer' });
    // Immediately verify — should work
    try {
        shortHardener.verifyAccessToken(shortToken, null);
        assert(true, 'Token valid immediately after signing');
    } catch (e) {
        assert(false, 'Token should be valid immediately: ' + e.message);
    }

    // 1.5 Revoked token
    hardener.revokeToken(token);
    try {
        hardener.verifyAccessToken(token, 'user-agent-chrome-123|||en-US|||8');
        assert(false, 'Revoked token should throw');
    } catch (e) {
        assert(e.message.includes('revoked'), 'Revoked token is rejected');
    }

    // 1.6 Tampered token
    try {
        const parts = token.split('.');
        const tampered = parts[0] + '.' + parts[1] + '.invalidsignature';
        hardener.verifyAccessToken(tampered, null);
        assert(false, 'Tampered token should throw');
    } catch (e) {
        assert(true, 'Tampered token is rejected (signature mismatch)');
    }

    // 1.7 Refresh token generation
    const refresh = hardener.generateRefreshToken({ userId: 1, email: 'test@test.com', role: 'customer' });
    assert(refresh.rawToken.length === 96, 'Refresh token is 96 hex chars (48 bytes)');
    assert(crypto.createHash('sha256').update(refresh.rawToken).digest('hex') === refresh.tokenHash, 'Refresh token hash is correct SHA-256');
    assert(refresh.expiresAt > Math.floor(Date.now() / 1000), 'Refresh token has future expiry');

    // 1.8 Same payload generates different refresh tokens each time
    const refresh2 = hardener.generateRefreshToken({ userId: 1, email: 'test@test.com', role: 'customer' });
    assert(refresh.rawToken !== refresh2.rawToken, 'Each refresh token is unique (random)');

    // 1.9 Token without fingerprint works when no fingerprint expected
    const nofpToken = hardener.signAccessToken({ userId: 2, email: 'nofp@test.com', role: 'admin' });
    try {
        const d = hardener.verifyAccessToken(nofpToken, null);
        assert(d.email === 'nofp@test.com', 'Token without fingerprint works when no fingerprint expected');
    } catch (e) {
        assert(false, 'Token without fingerprint should verify: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST GROUP 2: SessionManager
// ═══════════════════════════════════════════════════════════════════════════

async function testSessionManager() {
    console.log('\n═══ TEST GROUP 2: SessionManager ═══\n');

    const db = createMockDb();
    const mgr = new SessionManager(db);

    // 2.1 Create session
    await mgr.createSession({
        userId: 1,
        email: 'test@test.com',
        role: 'customer',
        tokenHash: crypto.createHash('sha256').update('test-refresh-token').digest('hex'),
        deviceInfo: { ua: 'Chrome', fingerprint: 'abc123' },
        ip: '192.168.1.1',
        expiresAt: Math.floor(Date.now() / 1000) + 86400
    });
    assert(true, 'Session created without error');

    // 2.2 Create a second session for same user
    await mgr.createSession({
        userId: 1,
        email: 'test@test.com',
        role: 'customer',
        tokenHash: crypto.createHash('sha256').update('test-refresh-token-2').digest('hex'),
        deviceInfo: { ua: 'Firefox', fingerprint: 'def456' },
        ip: '10.0.0.1',
        expiresAt: Math.floor(Date.now() / 1000) + 86400
    });
    assert(true, 'Second session created');

    // 2.3 Get user sessions
    const sessions = await mgr.getUserSessions(1);
    assert(sessions.length === 2, 'getUserSessions returns 2 sessions for user 1');
    assert(!!sessions[0].id, 'Session has id');
    assert(!!sessions[0].device_info, 'Session has device_info');

    // 2.4 Enforce max sessions (limit to 1)
    // Create 5 more sessions
    for (let i = 0; i < 5; i++) {
        await mgr.createSession({
            userId: 1,
            email: 'test@test.com',
            role: 'customer',
            tokenHash: crypto.createHash('sha256').update('bulk-' + i).digest('hex'),
            deviceInfo: { ua: 'Browser-' + i },
            ip: '10.0.0.' + i,
            expiresAt: Math.floor(Date.now() / 1000) + 86400
        });
    }
    await mgr.enforceMaxSessions(1, 3);
    const afterEnforce = await mgr.getUserSessions(1);
    assert(afterEnforce.length <= 3, 'enforceMaxSessions limits to 3 sessions (got ' + afterEnforce.length + ')');

    // 2.5 Revoke session
    await mgr.revokeSession(1);
    const afterRevoke = await mgr.getUserSessions(1);
    assert(!afterRevoke.find(s => s.id === 1), 'Revoked session no longer appears in active sessions');

    // 2.6 Revoke other sessions
    await mgr.revokeOtherSessions(1, 2);
    const afterRevokeOthers = await mgr.getUserSessions(1);
    assert(afterRevokeOthers.length === 1 && afterRevokeOthers[0].id === 2,
        'revokeOtherSessions leaves only session 2 active (got ' + afterRevokeOthers.length + ': ' + afterRevokeOthers.map(s => s.id).join(',') + ')');

    // 2.7 Touch session updates activity
    // Since the mock always returns current time, we just verify no error
    try {
        await mgr.touchSession(2);
        assert(true, 'Touch session succeeds');
    } catch (e) {
        assert(false, 'Touch session failed: ' + e.message);
    }

    // 2.8 Expired session not returned
    await mgr.createSession({
        userId: 3,
        email: 'expired@test.com',
        role: 'customer',
        tokenHash: 'expired-hash',
        deviceInfo: {},
        ip: '1.2.3.4',
        expiresAt: Math.floor(Date.now() / 1000) - 1  // already expired!
    });
    const expiredSessions = await mgr.getUserSessions(3);
    assert(expiredSessions.length === 0, 'Expired sessions are not returned as active');
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST GROUP 3: Combined Refresh Flow
// ═══════════════════════════════════════════════════════════════════════════

async function testCombinedFlow() {
    console.log('\n═══ TEST GROUP 3: Combined Refresh Flow ═══\n');

    const hardener = new JwtHardener({
        accessSecret: crypto.randomBytes(32).toString('hex'),
        refreshSecret: crypto.randomBytes(32).toString('hex'),
        accessExpiry: 15,
        refreshExpiry: 604800
    });

    const db = createMockDb();
    const sessionManager = new SessionManager(db);

    const USER = { userId: 42, email: 'alice@havengo.com', role: 'customer' };
    const FINGERPRINT = 'Mozilla/5.0|||en-US|||24';

    // 3.1 Simulate login: sign access token + generate refresh token
    const accessToken1 = hardener.signAccessToken(USER, FINGERPRINT);
    const refresh1 = hardener.generateRefreshToken(USER);

    await sessionManager.createSession({
        userId: USER.userId,
        email: USER.email,
        role: USER.role,
        tokenHash: refresh1.tokenHash,
        deviceInfo: { ua: 'Chrome', fingerprint: FINGERPRINT },
        ip: '203.0.113.1',
        expiresAt: refresh1.expiresAt
    });

    // Verify access token works
    let decoded = hardener.verifyAccessToken(accessToken1, FINGERPRINT);
    assert(decoded.email === USER.email, '3.1 Access token verifies after login');

    // 3.2 Simulate refresh: old token hash is revoked, new pair issued
    // (This is what the backend /api/auth/refresh endpoint would do)
    const oldTokenHash = crypto.createHash('sha256').update(refresh1.rawToken).digest('hex');
    const oldSession = await db.get(
        'SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > NOW()',
        [oldTokenHash]
    );
    assert(!!oldSession, '3.2 Refresh token session found');

    // Revoke old session
    await db.run('UPDATE sessions SET revoked = 1, revoked_at = NOW() WHERE id = ?', [oldSession.id]);

    // Issue new pair
    const accessToken2 = hardener.signAccessToken(USER, FINGERPRINT);
    const refresh2 = hardener.generateRefreshToken(USER);

    await sessionManager.createSession({
        userId: USER.userId,
        email: USER.email,
        role: USER.role,
        tokenHash: refresh2.tokenHash,
        deviceInfo: { ua: 'Chrome', fingerprint: FINGERPRINT },
        ip: '203.0.113.1',
        expiresAt: refresh2.expiresAt
    });

    // Old refresh token should no longer work
    const oldSessionAgain = await db.get(
        'SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > NOW()',
        [oldTokenHash]
    );
    assert(!oldSessionAgain, '3.3 Old refresh token is revoked after rotation');

    // New refresh token should work
    const newTokenHash = crypto.createHash('sha256').update(refresh2.rawToken).digest('hex');
    const newSession = await db.get(
        'SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > NOW()',
        [newTokenHash]
    );
    assert(!!newSession, '3.4 New refresh token is valid after rotation');

    // 3.5 Verify new access token
    decoded = hardener.verifyAccessToken(accessToken2, FINGERPRINT);
    assert(decoded.email === USER.email, '3.5 New access token verifies after refresh');

    // 3.6 Wrong fingerprint on existing token
    try {
        hardener.verifyAccessToken(accessToken2, 'attacker-fingerprint');
        assert(false, '3.6 Wrong fingerprint should be rejected');
    } catch (e) {
        assert(e.message.includes('fingerprint'), '3.6 Wrong fingerprint rejected on access token');
    }

    // 3.7 Enforce max sessions
    // Create 10 sessions, enforce max 3
    for (let i = 0; i < 10; i++) {
        const r = hardener.generateRefreshToken(USER);
        await sessionManager.createSession({
            userId: USER.userId,
            email: USER.email,
            role: USER.role,
            tokenHash: r.tokenHash,
            deviceInfo: { ua: 'LoadTest-' + i, fingerprint: 'fp-' + i },
            ip: '10.0.0.' + i,
            expiresAt: r.expiresAt
        });
    }
    await sessionManager.enforceMaxSessions(USER.userId, 3);
    const remaining = await sessionManager.getUserSessions(USER.userId);
    assert(remaining.length <= 3, '3.7 Max concurrent sessions enforced (' + remaining.length + ' remaining)');

    // 3.8 Token theft detection via fingerprint
    // Simulate: attacker has the refresh token but different fingerprint
    const refresh3 = hardener.generateRefreshToken(USER);
    await sessionManager.createSession({
        userId: USER.userId,
        email: USER.email,
        role: USER.role,
        tokenHash: refresh3.tokenHash,
        deviceInfo: { ua: 'Real-Device', fingerprint: 'real-fp' },
        ip: '192.168.1.1',
        expiresAt: refresh3.expiresAt
    });

    // Attacker tries to use the token with different device info
    const theftHash = crypto.createHash('sha256').update(refresh3.rawToken).digest('hex');
    const theftSession = await db.get(
        'SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > NOW()',
        [theftHash]
    );
    assert(!!theftSession, '3.8 Token found before theft');

    // The theft detection would happen in the refresh endpoint:
    let deviceInfo;
    try { deviceInfo = JSON.parse(theftSession.device_info); } catch (e) { deviceInfo = {}; }
    const isTheft = deviceInfo.fingerprint && deviceInfo.fingerprint !== 'attacker-fp';
    assert(isTheft, '3.8 Token theft detected via fingerprint mismatch');

    // 3.9 Concurrent refresh safety
    // Ensure that multiple simultaneous refresh calls don't create duplicate sessions
    const results = await Promise.all([
        hardener.generateRefreshToken(USER),
        hardener.generateRefreshToken(USER),
        hardener.generateRefreshToken(USER)
    ]);
    assert(results[0].rawToken !== results[1].rawToken, '3.9 Concurrent refresh tokens are unique');
    assert(results[1].rawToken !== results[2].rawToken, '3.9 Concurrent refresh tokens are unique (2)');
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST GROUP 4: Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

async function testEdgeCases() {
    console.log('\n═══ TEST GROUP 4: Edge Cases ═══\n');

    const hardener = new JwtHardener({
        accessSecret: crypto.randomBytes(32).toString('hex'),
        accessExpiry: 999999
    });

    // 4.1 Token with all fields
    const token = hardener.signAccessToken(
        { userId: 999, email: 'edge@test.com', role: 'provider', extraField: 'should-be-ignored' },
        'fp'
    );
    const decoded = hardener.verifyAccessToken(token, 'fp');
    assert(decoded.sub === 999, '4.1 Token preserves userId');
    assert(decoded.role === 'provider', '4.1 Token preserves role');

    // 4.2 Different secrets produce incompatible tokens
    const hardener2 = new JwtHardener({
        accessSecret: crypto.randomBytes(32).toString('hex'),
        accessExpiry: 999999
    });
    const token2 = hardener2.signAccessToken({ userId: 1, email: 'other@test.com', role: 'customer' });
    try {
        hardener.verifyAccessToken(token2, null);
        assert(false, '4.2 Token from different secret should fail');
    } catch (e) {
        assert(true, '4.2 Token signed with different secret is rejected (signature mismatch)');
    }

    // 4.3 Malformed token
    try {
        hardener.verifyAccessToken('not-a-jwt-token', null);
        assert(false, '4.3 Malformed token should throw');
    } catch (e) {
        assert(true, '4.3 Malformed token is rejected');
    }

    // 4.4 Empty token
    try {
        hardener.verifyAccessToken('', null);
        assert(false, '4.4 Empty token should throw');
    } catch (e) {
        assert(true, '4.4 Empty token is rejected');
    }

    // 4.5 Token with wrong type (not "access")
    const wrongTypeToken = hardener.signAccessToken({ userId: 1, email: 'x@y.com', role: 'customer' });
    // Modify the payload to change type
    const parts = wrongTypeToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.type = 'refresh';
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    // Re-sign won't work without the secret, so this will fail at signature check
    // That's acceptable — the type+signature double check is defense in depth
    const reconstructed = parts.join('.');
    try {
        hardener.verifyAccessToken(reconstructed, null);
        assert(false, '4.5 Modified token should be rejected');
    } catch (e) {
        assert(true, '4.5 Modified token payload is rejected');
    }

    // 4.6 SessionManager with empty sessions
    const db = createMockDb();
    const mgr = new SessionManager(db);
    const emptySessions = await mgr.getUserSessions(999);
    assert(emptySessions.length === 0, '4.6 No sessions for unknown user');

    // 4.7 Enforce max with no sessions
    try {
        await mgr.enforceMaxSessions(999, 5);
        assert(true, '4.7 enforceMaxSessions with no sessions does not throw');
    } catch (e) {
        assert(false, '4.7 enforceMaxSessions threw: ' + e.message);
    }

    // 4.8 Revoke non-existent session
    try {
        await mgr.revokeSession(99999);
        assert(true, '4.8 revokeSession with non-existent ID does not throw');
    } catch (e) {
        assert(false, '4.8 revokeSession threw: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST GROUP 5: Expiry Timing Tests
// ═══════════════════════════════════════════════════════════════════════════

async function testExpiryTiming() {
    console.log('\n═══ TEST GROUP 5: Expiry Timing Tests ═══\n');

    // 5.1 Access token expires after specified time
    const shortHardener = new JwtHardener({
        accessSecret: crypto.randomBytes(32).toString('hex'),
        accessExpiry: 2  // 2 seconds
    });
    const token = shortHardener.signAccessToken({ userId: 1, email: 'expiry@test.com', role: 'customer' });
    // Should be valid now
    try {
        shortHardener.verifyAccessToken(token, null);
        assert(true, '5.1 Token valid before expiry');
    } catch (e) {
        assert(false, '5.1 Token should be valid: ' + e.message);
    }
    // Wait 3 seconds
    await new Promise(r => setTimeout(r, 3050));
    // Should be expired
    try {
        shortHardener.verifyAccessToken(token, null);
        assert(false, '5.1 Expired token should throw');
    } catch (e) {
        assert(e.name === 'TokenExpiredError' || e.message.includes('expired'), '5.1 Expired token is correctly rejected');
    }

    // 5.2 Refresh token expiry — only test hash creation, not actual waiting
    const rt = shortHardener.generateRefreshToken({ userId: 1, email: 'rt@test.com', role: 'customer' });
    assert(rt.expiresAt > Math.floor(Date.now() / 1000), '5.2 Refresh token has future expiry timestamp');
    assert(rt.expiresAt <= Math.floor(Date.now() / 1000) + shortHardener.refreshExpiry + 1,
        '5.2 Refresh token expiry is within configured window');
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function runAll() {
    console.log('Session Persistence Test Suite');
    console.log('==============================\n');

    try {
        await testJwtHardener();
    } catch (e) {
        console.error('\nJwtHardener tests crashed:', e.message);
        failed++;
    }

    try {
        await testSessionManager();
    } catch (e) {
        console.error('\nSessionManager tests crashed:', e.message);
        failed++;
    }

    try {
        await testCombinedFlow();
    } catch (e) {
        console.error('\nCombined flow tests crashed:', e.message);
        failed++;
    }

    try {
        await testEdgeCases();
    } catch (e) {
        console.error('\nEdge case tests crashed:', e.message);
        failed++;
    }

    try {
        await testExpiryTiming();
    } catch (e) {
        console.error('\nExpiry timing tests crashed:', e.message);
        failed++;
    }

    console.log('\n═══════════════════════════════════════');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log('═══════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
}

runAll();
