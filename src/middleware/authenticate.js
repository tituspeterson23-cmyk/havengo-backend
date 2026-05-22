const { verifyToken } = require('../auth');

// Authenticate - verifies JWT token from Authorization header
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = decoded;
  next();
}

// Admin only - must be called AFTER authenticate
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Provider only - must be called AFTER authenticate
function providerOnly(req, res, next) {
  if (!req.user || req.user.role !== 'provider') {
    return res.status(403).json({ error: 'Provider access required' });
  }
  next();
}

module.exports = { authenticate, adminOnly, providerOnly };
