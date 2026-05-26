const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { sanitize } = require('../auth');

router.use(authenticate);

router.post('/update', async (req, res) => {
  const { orderId, lat, lng, role } = req.body;
  if (!orderId || lat === undefined || lng === undefined || !role) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const db = getDb();
  const email = req.user.email;
  const existing = await db.prepare('SELECT id FROM tracking WHERE order_id = ? AND user_email = ?').get(orderId, email);
  if (existing) {
    await db.prepare("UPDATE tracking SET lat = ?, lng = ?, updated_at = NOW() WHERE id = ?").run(lat, lng, existing.id);
  } else {
    await db.prepare('INSERT INTO tracking (order_id, user_email, lat, lng, role) VALUES (?, ?, ?, ?, ?)').run(orderId, email, lat, lng, role);
  }
  res.json({ success: true });
});

router.get('/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const db = getDb();
  const email = req.user.email;
  const userRole = req.query.role || 'customer';
  const otherRole = userRole === 'customer' ? 'provider' : 'customer';
  const track = await db.prepare('SELECT lat, lng, role, updated_at FROM tracking WHERE order_id = ? AND role = ?').get(orderId, otherRole);
  if (!track) return res.json({ active: false });
  res.json({ active: true, lat: track.lat, lng: track.lng, role: track.role, updatedAt: track.updated_at });
});

module.exports = router;
