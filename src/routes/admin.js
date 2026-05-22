const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate, adminOnly } = require('../middleware/authenticate');
const { sanitize, encrypt, decrypt, hashPassword } = require('../auth');

// All admin routes require authentication + admin role
router.use(authenticate, adminOnly);

// GET /api/admin/providers - all providers
router.get('/providers', (req, res) => {
  const db = getDb();
  const providers = db.prepare('SELECT id, firstname, lastname, email, phone, business_name, services, bitmoji, verified, total_earnings, created_at FROM providers').all();
  res.json(providers);
});

// GET /api/admin/providers/pending - unverified providers
router.get('/providers/pending', (req, res) => {
  const db = getDb();
  const pending = db.prepare("SELECT id, firstname, lastname, email, phone, business_name, services, bitmoji, created_at FROM providers WHERE verified = 0").all();
  res.json(pending);
});

// POST /api/admin/providers/verify/:id
router.post('/providers/verify/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid provider ID' });
  const result = db.prepare('UPDATE providers SET verified = 1 WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Provider not found' });
  res.json({ success: true, message: 'Provider verified' });
});

// POST /api/admin/providers/reject/:id
router.post('/providers/reject/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid provider ID' });
  const result = db.prepare('DELETE FROM providers WHERE id = ? AND verified = 0').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Provider not found or already verified' });
  res.json({ success: true, message: 'Provider rejected and removed' });
});

// DELETE /api/admin/providers/:id
router.delete('/providers/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid provider ID' });
  const result = db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Provider not found' });
  res.json({ success: true, message: 'Provider deleted' });
});

// GET /api/admin/price-requests
router.get('/price-requests', (req, res) => {
  const db = getDb();
  const requests = db.prepare("SELECT * FROM price_requests WHERE status = 'pending'").all();
  res.json(requests);
});

// POST /api/admin/price-requests/:id/approve
router.post('/price-requests/:id/approve', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { adjustedPrice } = req.body;
  if (!id) return res.status(400).json({ error: 'Invalid request ID' });
  const request = db.prepare('SELECT * FROM price_requests WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const finalPrice = adjustedPrice || request.requested_price;
  // Price change logic would update the service price
  db.prepare("UPDATE price_requests SET status = 'approved' WHERE id = ?").run(id);
  res.json({ success: true, message: 'Price request approved', approvedPrice: finalPrice });
});

// POST /api/admin/price-requests/:id/reject
router.post('/price-requests/:id/reject', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid request ID' });
  db.prepare("UPDATE price_requests SET status = 'rejected' WHERE id = ?").run(id);
  res.json({ success: true, message: 'Price request rejected' });
});

// GET /api/admin/revenue
router.get('/revenue', (req, res) => {
  const db = getDb();
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(price * 0.15), 0) as revenue FROM completed_tasks WHERE paid = 1").get();
  const totalCompleted = db.prepare("SELECT COUNT(*) as count FROM completed_tasks WHERE paid = 1").get();
  const revenueByProvider = db.prepare("SELECT provider_name, COALESCE(SUM(price * 0.15), 0) as revenue, COUNT(*) as jobs FROM completed_tasks WHERE paid = 1 GROUP BY provider_name").all();
  res.json({ revenue: totalRevenue.revenue, completedJobs: totalCompleted.count, byProvider: revenueByProvider });
});

// GET /api/admin/chat/conversations
router.get('/chat/conversations', (req, res) => {
  const db = getDb();
  const convs = db.prepare('SELECT DISTINCT conversation_id FROM chat_messages ORDER BY created_at DESC').all();
  res.json(convs.map(c => c.conversation_id));
});

// GET /api/admin/chat/:conversationId
router.get('/chat/:conversationId', (req, res) => {
  const db = getDb();
  const messages = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.conversationId);
  // Decrypt encrypted messages
  const decrypted = messages.map(m => {
    if (m.encrypted) {
      const dec = decrypt(m.message);
      return { ...m, message: dec || '[encrypted]' };
    }
    return m;
  });
  res.json(decrypted);
});

// POST /api/admin/chat/send
router.post('/chat/send', (req, res) => {
  const { conversationId, message } = req.body;
  if (!conversationId || !message) return res.status(400).json({ error: 'Missing fields' });
  const db = getDb();
  const encrypted = encrypt(message);
  db.prepare('INSERT INTO chat_messages (conversation_id, sender, message, encrypted) VALUES (?, ?, ?, 1)')
    .run(conversationId, 'Admin', encrypted);
  res.json({ success: true });
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, firstname, lastname, email, phone, bitmoji, balance, created_at FROM users').all();
  res.json(users);
});

// GET /api/admin/dashboard-stats
router.get('/dashboard-stats', (req, res) => {
  const db = getDb();
  const totalProviders = db.prepare('SELECT COUNT(*) as count FROM providers').pluck().get();
  const pendingVerification = db.prepare('SELECT COUNT(*) as count FROM providers WHERE verified = 0').pluck().get();
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(price * 0.15), 0) as rev FROM completed_tasks WHERE paid = 1").pluck().get();
  const pendingPriceRequests = db.prepare("SELECT COUNT(*) as count FROM price_requests WHERE status = 'pending'").pluck().get();
  res.json({ totalProviders, pendingVerification, totalRevenue, pendingPriceRequests });
});

// GET /api/admin/notifications
router.get('/notifications', (req, res) => {
  const db = getDb();
  const adminEmail = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  const email = adminEmail || 'admin';
  const notifs = db.prepare("SELECT * FROM notifications WHERE user_email = ? AND (expiry IS NULL OR expiry > datetime('now')) ORDER BY created_at DESC LIMIT 50").all(email);
  res.json(notifs);
});

router.post('/notifications/clear', (req, res) => {
  const db = getDb();
  const adminEmail = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  db.prepare('DELETE FROM notifications WHERE user_email = ?').run(adminEmail || 'admin');
  res.json({ success: true });
});

module.exports = router;
