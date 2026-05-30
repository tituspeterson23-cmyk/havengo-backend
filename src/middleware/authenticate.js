const { verifyToken } = require('../auth');
const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'havengo_ug_5^Kp#9mX$2vR!qLz@8wN&bYdEfGhIj');
      return res.status(401).json({ error: 'Authentication required' });
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Authentication required' });
    }
  }
  req.user = decoded;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function providerOnly(req, res, next) {
  if (!req.user || req.user.role !== 'provider') {
    return res.status(403).json({ error: 'Provider access required' });
  }
  next();
}

module.exports = { authenticate, adminOnly, providerOnly };
