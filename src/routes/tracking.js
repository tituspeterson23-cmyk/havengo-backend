const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { sanitize } = require('../auth');

router.use(authenticate);

// POST /api/tracking/update — save current location for an order
router.post('/update', (req, res) => {
  const { orderId, lat, lng, role } = req.body;
  if (!orderId || lat === undefined || lng === undefined || !role) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const db = getDb();
  const email = req.user.email;
  // Upsert tracking record
  const existing = db.prepare('SELECT id FROM tracking WHERE order_id = ? AND user_email = ?').get(orderId, email);
  if (existing) {
    db.prepare('UPDATE tracking SET lat = ?, lng = ?, updated_at = datetime(\'now\') WHERE id = ?').run(lat, lng, existing.id);
  } else {
    db.prepare('INSERT INTO tracking (order_id, user_email, lat, lng, role) VALUES (?, ?, ?, ?, ?)').run(orderId, email, lat, lng, role);
  }
  res.json({ success: true });
});

// GET /api/tracking/:orderId — get the other party's location
router.get('/:orderId', (req, res) => {
  const { orderId } = req.params;
  const db = getDb();
  const email = req.user.email;
  // Get the opposite role's tracking data
  const userRole = req.query.role || 'customer';
  const otherRole = userRole === 'customer' ? 'provider' : 'customer';
  const track = db.prepare('SELECT lat, lng, role, updated_at FROM tracking WHERE order_id = ? AND role = ?').get(orderId, otherRole);
  if (!track) return res.json({ active: false });
  res.json({ active: true, lat: track.lat, lng: track.lng, role: track.role, updatedAt: track.updated_at });
});

module.exports = router;
