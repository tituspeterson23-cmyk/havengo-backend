const { Router } = require('express');
const crypto = require('crypto');
const { getDb } = require('../database');
const { JwtHardener, SessionManager } = require('../security');

const hardener = new JwtHardener();
let sessionManager = null;

function getSessionManager() {
  if (!sessionManager) sessionManager = new SessionManager(getDb());
  return sessionManager;
}

module.exports = function refreshRouter() {
  const router = Router();
  const mgr = () => getSessionManager();

  // POST /api/auth/refresh — silent token refresh
  router.post('/refresh', async (req, res) => {
    const { refreshToken, fingerprint } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const db = getDb();
    try {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const session = await mgr().getSessionByTokenHash(tokenHash);
      if (!session) {
        return res.status(401).json({ error: 'Session expired. Please login again.' });
      }

      // Revoke old session (rotation)
      await mgr().revokeSession(session.id);

      // Check device fingerprint if provided
      if (fingerprint && session.fingerprint && session.fingerprint !== fingerprint) {
        console.warn('Token theft detected for user', session.email);
        await db.prepare(
          `INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)`
        ).run(session.email, '🔒', 'Security Alert',
          'Your account was accessed from a new device. If this was not you, change your password immediately.',
          'security');
        return res.status(401).json({ error: 'Session expired. Please login again.' });
      }

      // Generate new token pair
      const payload = { userId: session.user_id, email: session.email, role: session.role };
      const newAccessToken = hardener.signAccessToken(payload, fingerprint);
      const newRefresh = hardener.generateRefreshToken();

      // Create new session
      await mgr().createSession({
        userId: session.user_id,
        email: session.email,
        role: session.role,
        tokenHash: newRefresh.tokenHash,
        deviceInfo: session.device_info ? JSON.parse(session.device_info) : {},
        ip: req.ip,
        fingerprint: fingerprint || session.fingerprint || '',
        expiresAt: newRefresh.expiresAt
      });

      // Enforce max concurrent sessions
      await mgr().enforceMaxSessions(session.user_id, 5);

      res.json({
        accessToken: newAccessToken,
        refreshToken: newRefresh.rawToken,
        expiresIn: hardener.accessExpiry
      });
    } catch (e) {
      console.error('Refresh error:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/auth/logout — revoke session
  router.post('/logout', async (req, res) => {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await mgr().revokeByTokenHash(tokenHash);
    }
    res.json({ success: true });
  });

  // GET /api/auth/sessions — list active sessions for current user (requires auth)
  router.get('/sessions', require('../middleware/authenticate').authenticate, async (req, res) => {
    const db = getDb();
    let user = await db.prepare('SELECT id FROM users WHERE email = ?').get(req.user.email);
    if (!user) {
      user = await db.prepare('SELECT id FROM providers WHERE email = ?').get(req.user.email);
    }
    if (!user) return res.json([]);
    const sessions = await mgr().getUserSessions(user.id);
    res.json(sessions);
  });

  // POST /api/auth/sessions/revoke — revoke a specific session (requires auth)
  router.post('/sessions/revoke', require('../middleware/authenticate').authenticate, async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Session ID required' });
    await mgr().revokeSession(parseInt(sessionId));
    res.json({ success: true });
  });

  return router;
};
