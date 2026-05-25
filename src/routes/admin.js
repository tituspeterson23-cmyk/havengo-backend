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
  const providers = db.prepare('SELECT id, firstname, lastname, email, phone, business_name, services, bitmoji, verified, total_earnings, created_at, location, bio, experience, registration_fee_paid FROM providers').all();
  res.json(providers);
});

// GET /api/admin/providers/pending - unverified providers
router.get('/providers/pending', (req, res) => {
  const db = getDb();
  const pending = db.prepare("SELECT id, firstname, lastname, email, phone, business_name, services, bitmoji, created_at, location, bio, experience, registration_fee_paid FROM providers WHERE verified = 0").all();
  res.json(pending);
});

// POST /api/admin/providers/verify/:id
router.post('/providers/verify/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid provider ID' });
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const result = db.prepare('UPDATE providers SET verified = 1 WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Provider not found' });
  // Notify provider that they've been verified
  db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(provider.email, '✅', 'Application Approved', 'Your HavenGo provider application has been approved! Please log in and pay the 50,000 UGX registration fee to start receiving orders.', 'provider_verified');
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
  const requests = db.prepare("SELECT * FROM price_requests ORDER BY created_at DESC").all();
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
  // Notify the conversation participant customer or provider
  if (conversationId.startsWith('customer-admin-')) {
    const userEmail = conversationId.replace('customer-admin-', '');
    if (userEmail) {
      db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(userEmail, '💬', 'New Message from Admin', message.substring(0, 100), 'chat');
    }
  } else if (conversationId.startsWith('provider-admin-')) {
    const providerEmail = conversationId.replace('provider-admin-', '');
    if (providerEmail) {
      db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(providerEmail, '💬', 'New Message from Admin', message.substring(0, 100), 'chat');
    }
  }
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
  const notifs = db.prepare("SELECT * FROM notifications WHERE user_email = ? AND read = 0 AND (expiry IS NULL OR expiry > datetime('now')) ORDER BY created_at DESC LIMIT 50").all(email);
  res.json(notifs);
});

router.post('/notifications/clear', (req, res) => {
  const db = getDb();
  const adminEmail = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  db.prepare('DELETE FROM notifications WHERE user_email = ?').run(adminEmail || 'admin');
  res.json({ success: true });
});

router.post('/notifications/mark-seen', (req, res) => {
  const db = getDb();
  const adminEmail = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  db.prepare("UPDATE notifications SET read = 1 WHERE user_email = ? AND read = 0").run(adminEmail || 'admin');
  res.json({ success: true });
});

// DELETE /api/admin/chat/:conversationId/message/:messageId
router.delete('/chat/:conversationId/message/:messageId', (req, res) => {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?').get(req.params.messageId, req.params.conversationId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(req.params.messageId);
  res.json({ success: true });
});

// POST /api/admin/notify-provider — send notification to a provider
router.post('/notify-provider', (req, res) => {
  const { providerName, icon, title, message } = req.body;
  if (!providerName || !title) return res.status(400).json({ error: 'Missing required fields' });
  const db = getDb();
  const provider = db.prepare("SELECT email FROM providers WHERE business_name = ?").get(providerName);
  if (provider) {
    db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, 'price_update')")
      .run(provider.email, icon || '📋', title, message || '');
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Provider not found' });
  }
});

// GET /api/admin/payment-disputes — list disputed payments
router.get('/payment-disputes', (req, res) => {
  const db = getDb();
  const disputes = db.prepare("SELECT * FROM pending_payments WHERE status = 'disputed'").all();
  res.json(disputes);
});

// POST /api/admin/resolve-payment-dispute/:id — admin resolves dispute, continues payment
router.post('/resolve-payment-dispute/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { resolution } = req.body;
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const payment = db.prepare('SELECT * FROM pending_payments WHERE id = ? AND status = ?').get(id, 'disputed');
  if (!payment) return res.status(404).json({ error: 'Disputed payment not found' });
  if (resolution === 'release') {
    db.prepare("UPDATE pending_payments SET status = 'pending' WHERE id = ?").run(id);
    // Auto-process the payment now
    const customer = db.prepare('SELECT * FROM users WHERE email = ?').get(payment.customer_email);
    const providerAmount = payment.amount * 0.85;
    const systemAmount = payment.amount * 0.15;
    if (customer && customer.balance >= payment.amount) {
      db.prepare('UPDATE users SET balance = balance - ? WHERE email = ?').run(payment.amount, payment.customer_email);
    }
    db.prepare('UPDATE completed_tasks SET paid = 1 WHERE task_id = ?').run(payment.task_id);
    db.prepare("UPDATE pending_payments SET status = 'paid' WHERE id = ?").run(id);
    db.prepare('UPDATE providers SET total_earnings = total_earnings + ? WHERE business_name = ?').run(providerAmount, payment.provider_name);
    db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(payment.customer_email, '✅', 'Dispute Resolved', 'Your payment dispute has been resolved. UGX ' + payment.amount + ' has been processed.', 'payment');
    const prov = db.prepare("SELECT email FROM providers WHERE business_name = ?").get(payment.provider_name);
    if (prov) {
      db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(prov.email, '✅', 'Dispute Resolved', 'Payment dispute resolved. UGX ' + providerAmount + ' credited to your account.', 'payment');
    }
    res.json({ success: true, message: 'Payment released' });
  } else if (resolution === 'refund') {
    db.prepare("UPDATE pending_payments SET status = 'refunded' WHERE id = ?").run(id);
    db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(payment.customer_email, '💰', 'Dispute Resolved - Refunded', 'Your payment dispute has been resolved. The amount UGX ' + payment.amount + ' has been refunded.', 'payment');
    const prov = db.prepare("SELECT email FROM providers WHERE business_name = ?").get(payment.provider_name);
    if (prov) {
      db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(prov.email, 'ℹ️', 'Dispute Resolved', 'Payment dispute for task #' + payment.task_id + ' has been resolved with refund.', 'payment');
    }
    res.json({ success: true, message: 'Payment refunded' });
  } else {
    res.status(400).json({ error: 'Invalid resolution. Use "release" or "refund".' });
  }
});

// GET /api/admin/tasks — all active tasks (not completed/cancelled)
router.get('/tasks', (req, res) => {
  const db = getDb();
  const tasks = db.prepare("SELECT * FROM tasks WHERE status IN ('pending_confirmation', 'active')").all();
  res.json(tasks);
});

// POST /api/admin/tasks/reassign/:taskId — reassign task to another provider
router.post('/tasks/reassign/:taskId', (req, res) => {
  const db = getDb();
  const { providerName } = req.body;
  if (!providerName) return res.status(400).json({ error: 'Provider name required' });
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(parseInt(req.params.taskId));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'completed') return res.status(400).json({ error: 'Cannot reassign completed task' });
  db.prepare("UPDATE tasks SET provider_name = ?, status = 'pending_confirmation' WHERE id = ?").run(providerName, parseInt(req.params.taskId));
  // Notify new provider
  const newProv = db.prepare("SELECT email FROM providers WHERE business_name = ?").get(providerName);
  if (newProv) {
    db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(newProv.email, '📋', 'Order Assigned to You', 'A new order has been assigned to you by admin. Please review and confirm.', 'task');
  }
  res.json({ success: true, message: 'Task reassigned to ' + providerName });
});

// POST /api/admin/delete-notification/:id
router.post('/delete-notification/:id', (req, res) => {
  const db = getDb();
  const adminEmail = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_email = ?').run(parseInt(req.params.id), adminEmail || 'admin');
  res.json({ success: true });
});

module.exports = router;
