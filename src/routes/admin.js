const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate, adminOnly } = require('../middleware/authenticate');
const { sanitize, encrypt, decrypt, hashPassword } = require('../auth');
const { emitTaskEvent, emitNotification } = require('../firestore-events');

router.use(authenticate, adminOnly);

router.get('/providers', async (req, res) => {
  const db = getDb();
  const providers = await db.prepare("SELECT p.id, p.firstname, p.lastname, p.email, p.phone, p.business_name, p.services, p.bitmoji, p.verified, p.total_earnings, p.created_at, p.location, p.bio, p.experience, p.registration_fee_paid, (SELECT COUNT(*) FROM completed_tasks WHERE provider_id = p.id) as job_count FROM providers p").all();
  res.json(providers);
});

router.get('/providers/pending', async (req, res) => {
  const db = getDb();
  const pending = await db.prepare("SELECT id, firstname, lastname, email, phone, business_name, services, bitmoji, created_at, location, bio, experience, registration_fee_paid FROM providers WHERE verified = 0").all();
  res.json(pending);
});

router.post('/providers/verify/:id', async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid provider ID' });
  const provider = await db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const result = await db.prepare('UPDATE providers SET verified = 1 WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Provider not found' });
  await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(provider.email, '✅', 'Application Approved', 'Your HavenGo provider application has been approved! Please log in and pay the 50,000 UGX registration fee to start receiving orders.', 'provider_verified');
  res.json({ success: true, message: 'Provider verified' });
});

router.post('/providers/reject/:id', async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid provider ID' });
  const result = await db.prepare('DELETE FROM providers WHERE id = ? AND verified = 0').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Provider not found or already verified' });
  res.json({ success: true, message: 'Provider rejected and removed' });
});

router.delete('/providers/:id', async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid provider ID' });
  const result = await db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Provider not found' });
  res.json({ success: true, message: 'Provider deleted' });
});

router.get('/price-requests', async (req, res) => {
  const db = getDb();
  const requests = await db.prepare("SELECT * FROM price_requests ORDER BY created_at DESC").all();
  res.json(requests);
});

router.post('/price-requests/:id/approve', async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { adjustedPrice } = req.body;
  if (!id) return res.status(400).json({ error: 'Invalid request ID' });
  const request = await db.prepare('SELECT * FROM price_requests WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const finalPrice = adjustedPrice || request.requested_price;
  await db.prepare("UPDATE price_requests SET status = 'approved' WHERE id = ?").run(id);
  // Persist approved price globally for cross-device sync
  await db.prepare("INSERT INTO service_prices (service_id, price, provider_id, updated_at) VALUES (?, ?, ?, NOW()) ON CONFLICT (service_id) DO UPDATE SET price = EXCLUDED.price, provider_id = EXCLUDED.provider_id, updated_at = NOW()")
    .run(request.service_id, finalPrice, request.provider_id);
  // Notify provider
  const provider = await db.prepare("SELECT email FROM providers WHERE id = ?").get(request.provider_id);
  if (provider) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(provider.email, '✅', 'Price Request Approved', 'Your price change request for service was approved. New price: UGX ' + finalPrice, 'price_request');
  }
  res.json({ success: true, message: 'Price request approved', approvedPrice: finalPrice });
});

router.post('/price-requests/:id/reject', async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid request ID' });
  const request = await db.prepare('SELECT * FROM price_requests WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  await db.prepare("UPDATE price_requests SET status = 'rejected' WHERE id = ?").run(id);
  // Notify provider
  const provider = await db.prepare("SELECT email FROM providers WHERE id = ?").get(request.provider_id);
  if (provider) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(provider.email, '❌', 'Price Request Rejected', 'Your price change request for service was rejected.', 'price_request');
  }
  res.json({ success: true, message: 'Price request rejected' });
});

router.get('/revenue', async (req, res) => {
  const db = getDb();
  const totalRevenue = await db.prepare("SELECT COALESCE(SUM(price * 0.15), 0) as revenue FROM completed_tasks WHERE paid = 1").get();
  const totalCompleted = await db.prepare("SELECT COUNT(*) as count FROM completed_tasks WHERE paid = 1").get();
  const revenueByProvider = await db.prepare("SELECT provider_name, COALESCE(SUM(price * 0.15), 0) as revenue, COUNT(*) as jobs FROM completed_tasks WHERE paid = 1 GROUP BY provider_name").all();
  res.json({ revenue: totalRevenue.revenue, completedJobs: totalCompleted.count, byProvider: revenueByProvider });
});

router.get('/users/count', async (req, res) => {
  const db = getDb();
  const row = await db.prepare("SELECT COUNT(*) as count FROM users").get();
  res.json({ count: row.count });
});

router.get('/chat/conversations', async (req, res) => {
  const db = getDb();
  const convs = await db.prepare('SELECT DISTINCT conversation_id FROM chat_messages ORDER BY created_at DESC').all();
  res.json(convs.map(c => c.conversation_id));
});

router.get('/chat/:conversationId', async (req, res) => {
  const db = getDb();
  const messages = await db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.conversationId);
  const decrypted = messages.map(m => {
    if (m.encrypted) {
      const dec = decrypt(m.message);
      return { ...m, message: dec || '[encrypted]' };
    }
    return m;
  });
  res.json(decrypted);
});

router.post('/chat/send', async (req, res) => {
  const { conversationId, message } = req.body;
  if (!conversationId || !message) return res.status(400).json({ error: 'Missing fields' });
  const db = getDb();
  const encrypted = encrypt(message);
  await db.prepare('INSERT INTO chat_messages (conversation_id, sender, message, encrypted) VALUES (?, ?, ?, 1)')
    .run(conversationId, 'Admin', encrypted);
  if (conversationId.startsWith('customer-admin-')) {
    const userEmail = conversationId.replace('customer-admin-', '');
    if (userEmail) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(userEmail, '💬', 'New Message from Admin', message.substring(0, 100), 'chat');
    }
  } else if (conversationId.startsWith('provider-admin-')) {
    const providerEmail = conversationId.replace('provider-admin-', '');
    if (providerEmail) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(providerEmail, '💬', 'New Message from Admin', message.substring(0, 100), 'chat');
    }
  }
  res.json({ success: true });
});

router.get('/users', async (req, res) => {
  const db = getDb();
  const users = await db.prepare('SELECT id, firstname, lastname, email, phone, bitmoji, balance, created_at FROM users').all();
  res.json(users);
});

router.get('/dashboard-stats', async (req, res) => {
  const db = getDb();
  const totalProviders = await db.prepare('SELECT COUNT(*) as count FROM providers').pluck().get();
  const pendingVerification = await db.prepare('SELECT COUNT(*) as count FROM providers WHERE verified = 0').pluck().get();
  const totalRevenue = await db.prepare("SELECT COALESCE(SUM(price * 0.15), 0) as rev FROM completed_tasks WHERE paid = 1").pluck().get();
  const pendingPriceRequests = await db.prepare("SELECT COUNT(*) as count FROM price_requests WHERE status = 'pending'").pluck().get();
  res.json({ totalProviders, pendingVerification, totalRevenue, pendingPriceRequests });
});

router.get('/notifications', async (req, res) => {
  const db = getDb();
  const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  const email = adminEmail || 'admin';
  const notifs = await db.prepare("SELECT * FROM notifications WHERE user_email = ? AND read = 0 AND (expiry IS NULL OR expiry > NOW()) ORDER BY created_at DESC LIMIT 50").all(email);
  res.json(notifs);
});

router.post('/notifications/clear', async (req, res) => {
  const db = getDb();
  const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  await db.prepare('DELETE FROM notifications WHERE user_email = ?').run(adminEmail || 'admin');
  res.json({ success: true });
});

router.post('/notifications/mark-seen', async (req, res) => {
  const db = getDb();
  const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  await db.prepare("UPDATE notifications SET read = 1 WHERE user_email = ? AND read = 0").run(adminEmail || 'admin');
  res.json({ success: true });
});

router.delete('/chat/:conversationId/message/:messageId', async (req, res) => {
  const db = getDb();
  const msg = await db.prepare('SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?').get(req.params.messageId, req.params.conversationId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  await db.prepare('DELETE FROM chat_messages WHERE id = ?').run(req.params.messageId);
  res.json({ success: true });
});

router.post('/notify-provider', async (req, res) => {
  const { providerName, icon, title, message } = req.body;
  if (!providerName || !title) return res.status(400).json({ error: 'Missing required fields' });
  const db = getDb();
  const provider = await db.prepare("SELECT email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(providerName, providerName);
  if (provider) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, 'price_update')")
      .run(provider.email, icon || '📋', title, message || '');
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Provider not found' });
  }
});

router.get('/payment-disputes', async (req, res) => {
  const db = getDb();
  const disputes = await db.prepare("SELECT * FROM pending_payments WHERE status = 'disputed'").all();
  res.json(disputes);
});

router.post('/resolve-payment-dispute/:id', async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { resolution } = req.body;
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const payment = await db.prepare('SELECT * FROM pending_payments WHERE id = ? AND status = ?').get(id, 'disputed');
  if (!payment) return res.status(404).json({ error: 'Disputed payment not found' });
  if (resolution === 'release') {
    await db.prepare("UPDATE pending_payments SET status = 'pending' WHERE id = ?").run(id);
    const customer = await db.prepare('SELECT * FROM users WHERE email = ?').get(payment.customer_email);
    const providerAmount = payment.amount * 0.85;
    const systemAmount = payment.amount * 0.15;
    if (customer && customer.balance >= payment.amount) {
      await db.prepare('UPDATE users SET balance = balance - ? WHERE email = ?').run(payment.amount, payment.customer_email);
    }
    await db.prepare('UPDATE completed_tasks SET paid = 1 WHERE task_id = ?').run(payment.task_id);
    await db.prepare("UPDATE pending_payments SET status = 'paid' WHERE id = ?").run(id);
    await db.prepare('UPDATE providers SET total_earnings = total_earnings + ? WHERE business_name = ? OR (firstname || \' \' || lastname) = ?').run(providerAmount, payment.provider_name, payment.provider_name);
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(payment.customer_email, '✅', 'Dispute Resolved', 'Your payment dispute has been resolved. UGX ' + payment.amount + ' has been processed.', 'payment');
    const prov = await db.prepare("SELECT email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(payment.provider_name, payment.provider_name);
    if (prov) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(prov.email, '✅', 'Dispute Resolved', 'Payment dispute resolved. UGX ' + providerAmount + ' credited to your account.', 'payment');
    }
    res.json({ success: true, message: 'Payment released' });
  } else if (resolution === 'refund') {
    await db.prepare("UPDATE pending_payments SET status = 'refunded' WHERE id = ?").run(id);
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(payment.customer_email, '💰', 'Dispute Resolved - Refunded', 'Your payment dispute has been resolved. The amount UGX ' + payment.amount + ' has been refunded.', 'payment');
    const prov = await db.prepare("SELECT email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(payment.provider_name, payment.provider_name);
    if (prov) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(prov.email, 'ℹ️', 'Dispute Resolved', 'Payment dispute for task #' + payment.task_id + ' has been resolved with refund.', 'payment');
    }
    res.json({ success: true, message: 'Payment refunded' });
  } else {
    res.status(400).json({ error: 'Invalid resolution. Use "release" or "refund".' });
  }
});

router.get('/revenue/balance', async (req, res) => {
  const db = getDb();
  const totalRevenue = await db.prepare("SELECT COALESCE(SUM(price * 0.15), 0) as revenue FROM completed_tasks WHERE paid = 1").pluck().get();
  const withdrawn = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_withdrawn'").pluck().get();
  const withdrawnAmt = parseFloat(withdrawn) || 0;
  const available = Math.max(0, (totalRevenue || 0) - withdrawnAmt);
  res.json({ totalRevenue: totalRevenue || 0, withdrawn: withdrawnAmt, available });
});

router.post('/withdraw', async (req, res) => {
  const { amount, phone } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (!phone || phone.length < 10) return res.status(400).json({ error: 'Valid phone number required' });
  const db = getDb();
  const totalRevenue = await db.prepare("SELECT COALESCE(SUM(price * 0.15), 0) as revenue FROM completed_tasks WHERE paid = 1").pluck().get();
  const withdrawn = parseFloat(await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_withdrawn'").pluck().get()) || 0;
  const available = Math.max(0, (totalRevenue || 0) - withdrawn);
  if (amt > available) return res.status(400).json({ error: 'Insufficient revenue balance. Available: UGX ' + available.toLocaleString() });
  const newWithdrawn = withdrawn + amt;
  const existing = await db.prepare("SELECT id FROM admin_settings WHERE key = 'admin_withdrawn'").get();
  if (existing) {
    await db.prepare("UPDATE admin_settings SET value = ? WHERE key = 'admin_withdrawn'").run(newWithdrawn.toString());
  } else {
    await db.prepare("INSERT INTO admin_settings (key, value) VALUES ('admin_withdrawn', ?)").run(newWithdrawn.toString());
  }
  res.json({ success: true, message: 'UGX ' + amt.toLocaleString() + ' withdrawal to ' + phone + ' processed. Total withdrawn: UGX ' + newWithdrawn.toLocaleString() });
});

router.get('/tasks', async (req, res) => {
  const db = getDb();
  const tasks = await db.prepare("SELECT t.*, u.firstname AS customer_firstname, u.lastname AS customer_lastname, u.phone AS customer_phone, p.email AS provider_email, p.phone AS provider_phone, p.business_name AS provider_business, p.firstname AS provider_firstname, p.lastname AS provider_lastname FROM tasks t LEFT JOIN users u ON t.customer_email = u.email LEFT JOIN providers p ON (t.provider_name = p.business_name OR t.provider_name = (p.firstname || ' ' || p.lastname)) WHERE t.status IN ('pending_confirmation', 'active', 'cancelled') ORDER BY t.created_at DESC").all();
  res.json(tasks);
});

router.get('/task/:taskId', async (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.taskId);
  if (isNaN(taskId)) return res.status(400).json({ error: 'Invalid task ID' });
  const task = await db.prepare("SELECT t.id, t.customer_email, p.email AS provider_email, p.firstname AS provider_firstname, p.lastname AS provider_lastname, u.firstname AS customer_firstname, u.lastname AS customer_lastname FROM tasks t LEFT JOIN users u ON t.customer_email = u.email LEFT JOIN providers p ON (t.provider_name = p.business_name OR t.provider_name = (p.firstname || ' ' || p.lastname)) WHERE t.id = ?").get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

router.post('/tasks/reassign/:taskId', async (req, res) => {
  const db = getDb();
  const { providerName } = req.body;
  if (!providerName) return res.status(400).json({ error: 'Provider name required' });
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(parseInt(req.params.taskId));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'completed') return res.status(400).json({ error: 'Cannot reassign completed task' });
  // Look up provider_id by name
  const newProv = await db.prepare("SELECT id, email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(providerName, providerName);
  if (!newProv) return res.status(404).json({ error: 'Provider not found' });
  await db.prepare("UPDATE tasks SET provider_name = ?, provider_id = ?, provider_email = ?, status = 'pending_confirmation' WHERE id = ?").run(providerName, newProv.id, newProv.email, parseInt(req.params.taskId));
  await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(newProv.email, '📋', 'Order Assigned to You', 'A new order has been assigned to you by admin. Please review and confirm.', 'task');
  emitTaskEvent(req.params.taskId, 'order_reassigned', { providerEmail: newProv.email, status: 'pending_confirmation', serviceName: task.service_name });
  emitNotification(newProv.email, '📋', 'Order Assigned', 'Order #' + req.params.taskId + ' (' + task.service_name + ') assigned to you.', 'task');
  res.json({ success: true, message: 'Task reassigned to ' + providerName });
});

router.post('/tasks/cancel/:taskId', async (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'Invalid task ID' });
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'completed') return res.status(400).json({ error: 'Cannot cancel completed task' });
  await db.prepare("UPDATE tasks SET status = 'cancelled' WHERE id = ?").run(taskId);
  // Notify customer and provider
  if (task.customer_email) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(task.customer_email, '❌', 'Order Cancelled by Admin', 'Order #' + taskId + ' has been cancelled by admin.', 'task');
  }
  if (task.provider_email) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(task.provider_email, '❌', 'Order Cancelled by Admin', 'Order #' + taskId + ' has been cancelled by admin.', 'task');
  }
  emitTaskEvent(taskId, 'order_cancelled', { customerEmail: task.customer_email, providerEmail: task.provider_email, status: 'cancelled', serviceName: task.service_name });
  if (task.customer_email) emitNotification(task.customer_email, '❌', 'Order Cancelled', 'Your order #' + taskId + ' has been cancelled by admin.', 'order');
  if (task.provider_email) emitNotification(task.provider_email, '❌', 'Order Cancelled', 'Order #' + taskId + ' has been cancelled by admin.', 'order');
  res.json({ success: true, message: 'Order #' + taskId + ' cancelled' });
});

router.post('/tasks/remove/:taskId', async (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'Invalid task ID' });
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ? AND status = 'cancelled'").get(taskId);
  if (!task) return res.status(404).json({ error: 'Cancelled task not found' });
  await db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  res.json({ success: true, message: 'Task removed' });
});

router.get('/users/count', async (req, res) => {
  const db = getDb();
  const row = await db.prepare("SELECT COUNT(*) as count FROM users").get();
  res.json({ count: row.count });
});

router.post('/delete-notification/:id', async (req, res) => {
  const db = getDb();
  const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  await db.prepare('DELETE FROM notifications WHERE id = ? AND user_email = ?').run(parseInt(req.params.id), adminEmail || 'admin');
  res.json({ success: true });
});

module.exports = router;
