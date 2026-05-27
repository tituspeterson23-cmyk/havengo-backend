const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { sanitize } = require('../auth');

router.use(authenticate);

router.get('/profile', async (req, res) => {
  const db = getDb();
  const user = await db.prepare('SELECT id, firstname, lastname, email, phone, bitmoji, balance, created_at FROM users WHERE email = ?').get(req.user.email);
  if (!user) return res.status(401).json({ session_expired: true, error: 'Your session has expired. Please login again.' });
  res.json(user);
});

router.post('/update-profile', async (req, res) => {
  const { firstname, lastname, bitmoji } = req.body;
  const db = getDb();
  await db.prepare('UPDATE users SET firstname = ?, lastname = ?, bitmoji = ? WHERE email = ?')
    .run(sanitize(firstname || ''), sanitize(lastname || ''), bitmoji || '😊', req.user.email);
  res.json({ success: true });
});

router.get('/bookings', async (req, res) => {
  const db = getDb();
  const activeTasks = await db.prepare("SELECT * FROM tasks WHERE customer_email = ? AND status IN ('pending_confirmation', 'active')").all(req.user.email);
  const completedTasks = await db.prepare('SELECT * FROM completed_tasks WHERE customer_email = ?').all(req.user.email);
  res.json({ active: activeTasks, completed: completedTasks });
});

router.post('/place-order', async (req, res) => {
  const { serviceId, serviceName, providerName, price, address, details } = req.body;
  if (!serviceId || !serviceName || !price) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(req.user.email);
  if (!user) return res.status(401).json({ session_expired: true, error: 'Your session has expired. Please login again.' });
  if (user.balance < price) {
    return res.status(400).json({ error: 'Insufficient balance. Please deposit first.' });
  }

  const pName = providerName || '';
  // Look up provider_id when provider_name is known
  let providerId = null;
  if (pName) {
    const provRow = await db.prepare("SELECT id FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(pName, pName);
    if (provRow) providerId = provRow.id;
  }
  const inserted = await db.prepare('INSERT INTO tasks (customer_email, service_id, service_name, provider_name, provider_id, price, status, address, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .get(req.user.email, serviceId, sanitize(serviceName), sanitize(pName), providerId, price, 'pending_confirmation', sanitize(address || ''), sanitize(details || ''));
  const newTaskId = inserted.id;

  if (!pName) {
    const providers = await db.prepare("SELECT id, business_name FROM providers WHERE services LIKE ? AND verified = 1").all(`%${sanitize(serviceName)}%`);
    if (providers.length > 0) {
      await db.prepare("UPDATE tasks SET provider_name = ?, provider_id = ? WHERE id = ?")
        .run(providers[0].business_name, providers[0].id, newTaskId);
    }
  }

  const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  if (adminEmail) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(adminEmail, '📋', 'New Order', sanitize(serviceName) + ' ordered by ' + req.user.email + ' for UGX ' + price, 'order');
  }
  const assignedTask = await db.prepare("SELECT provider_name FROM tasks WHERE id = ?").get(newTaskId);
  const assignedProviderName = assignedTask ? assignedTask.provider_name : '';
  if (assignedProviderName) {
    const prov = await db.prepare("SELECT email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(assignedProviderName, assignedProviderName);
    if (prov) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(prov.email, '📋', 'New Order Assigned', 'New ' + sanitize(serviceName) + ' order assigned to you by ' + req.user.email + ' for UGX ' + price, 'order');
    }
  }

  res.json({ success: true, message: 'Order placed! Awaiting provider confirmation.', taskId: newTaskId });
});

router.get('/pending-payments', async (req, res) => {
  const db = getDb();
  const payments = await db.prepare("SELECT * FROM pending_payments WHERE customer_email = ? AND status = 'pending' ORDER BY completed_at DESC").all(req.user.email);
  res.json(payments);
});

router.post('/confirm-payment', async (req, res) => {
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ error: 'Missing task ID' });

  const db = getDb();
  const completed = await db.prepare('SELECT * FROM completed_tasks WHERE task_id = ? AND customer_email = ? AND paid = 0').get(taskId, req.user.email);

  if (!completed) return res.status(404).json({ error: 'Completed task not found or already paid' });

  const customer = await db.prepare('SELECT * FROM users WHERE email = ?').get(req.user.email);
  if (!customer) return res.status(401).json({ session_expired: true, error: 'Your session has expired. Please login again.' });
  if (customer.balance < completed.price) {
    return res.status(400).json({ error: 'Insufficient balance to confirm payment' });
  }
  await db.prepare('UPDATE users SET balance = balance - ? WHERE email = ?').run(completed.price, req.user.email);

  const providerAmount = completed.price * 0.85;
  const systemAmount = completed.price * 0.15;

  await db.prepare('UPDATE completed_tasks SET paid = 1 WHERE task_id = ?').run(taskId);
  await db.prepare("UPDATE pending_payments SET status = 'paid' WHERE task_id = ?").run(taskId);
  await db.prepare('UPDATE providers SET total_earnings = total_earnings + ? WHERE id = ?').run(providerAmount, completed.provider_id);
  // Track system revenue in admin_settings
  const currentBalance = await db.prepare("SELECT value FROM admin_settings WHERE key = 'system_balance'").pluck().get();
  const newBalance = (parseFloat(currentBalance) || 0) + systemAmount;
  await db.prepare("INSERT INTO admin_settings (key, value) VALUES ('system_balance', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(newBalance.toString());

  await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '💰', 'Payment Confirmed', 'Payment of " + completed.price + " UGX completed. Provider credited " + providerAmount + " UGX.', 'money')")
    .run(req.user.email);
  const prov = await db.prepare("SELECT email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(completed.provider_name, completed.provider_name);
  if (prov) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '💰', 'Payment Received', 'Payment of " + completed.price + " UGX received from " + req.user.email + " for " + completed.service_name + ".', 'money')")
      .run(prov.email);
  }

  res.json({ success: true, message: 'Payment confirmed!', providerAmount, systemAmount });
});

router.post('/deposit', async (req, res) => {
  const { amount } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const db = getDb();
  await db.prepare('UPDATE users SET balance = balance + ? WHERE email = ?').run(amt, req.user.email);
  res.json({ success: true, message: amt + ' UGX deposited' });
});

router.post('/withdraw', async (req, res) => {
  const { amount } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(req.user.email);
  if (!user) return res.status(401).json({ session_expired: true, error: 'Your session has expired. Please login again.' });

  const activeCount = await db.prepare("SELECT COUNT(*) as count FROM tasks WHERE customer_email = ? AND status = 'active'").get(req.user.email);
  if (activeCount.count > 0) {
    return res.status(400).json({ error: 'Cannot withdraw while you have an active order in progress' });
  }

  const pendingCount = await db.prepare("SELECT COUNT(*) as count FROM pending_payments WHERE customer_email = ? AND status = 'pending'").get(req.user.email);
  if (pendingCount.count > 0) {
    return res.status(400).json({ error: 'Cannot withdraw with pending payments' });
  }

  const fee = amt * 0.005;
  const totalDeduction = amt + fee;
  if (user.balance < totalDeduction) {
    return res.status(400).json({ error: 'Insufficient balance including withdrawal fee' });
  }

  await db.prepare('UPDATE users SET balance = balance - ? WHERE email = ?').run(totalDeduction, req.user.email);
  res.json({ success: true, message: amt + ' UGX withdrawn. Fee: ' + fee + ' UGX' });
});

router.get('/addresses', async (req, res) => {
  const db = getDb();
  const addresses = await db.prepare('SELECT * FROM user_addresses WHERE user_email = ?').all(req.user.email);
  res.json(addresses);
});

router.post('/addresses', async (req, res) => {
  const { label, address } = req.body;
  if (!address) return res.status(400).json({ error: 'Address is required' });
  const db = getDb();
  await db.prepare('INSERT INTO user_addresses (user_email, label, address) VALUES (?, ?, ?)')
    .run(req.user.email, sanitize(label || ''), sanitize(address));
  res.json({ success: true });
});

router.delete('/addresses/:id', async (req, res) => {
  const db = getDb();
  await db.prepare('DELETE FROM user_addresses WHERE id = ? AND user_email = ?').run(parseInt(req.params.id), req.user.email);
  res.json({ success: true });
});

router.post('/request-deletion', async (req, res) => {
  const db = getDb();
  const existing = await db.prepare("SELECT id FROM deletion_requests WHERE identifier = ? AND type = 'customer'").get(req.user.email);
  if (existing) return res.status(409).json({ error: 'Deletion already requested' });
  await db.prepare("INSERT INTO deletion_requests (identifier, type) VALUES (?, 'customer')").run(req.user.email);
  res.json({ success: true, message: 'Deletion requested. 15-day grace period active.' });
});

router.post('/cancel-deletion', async (req, res) => {
  const db = getDb();
  await db.prepare("DELETE FROM deletion_requests WHERE identifier = ? AND type = 'customer'").run(req.user.email);
  res.json({ success: true, message: 'Deletion cancelled' });
});

router.get('/notifications', async (req, res) => {
  const db = getDb();
  const notifs = await db.prepare("SELECT * FROM notifications WHERE user_email = ? AND read = 0 AND (expiry IS NULL OR expiry > NOW()) ORDER BY created_at DESC LIMIT 50").all(req.user.email);
  res.json(notifs);
});

router.post('/notifications/clear', async (req, res) => {
  const db = getDb();
  await db.prepare('DELETE FROM notifications WHERE user_email = ?').run(req.user.email);
  res.json({ success: true });
});

router.post('/notifications/mark-seen', async (req, res) => {
  const db = getDb();
  await db.prepare("UPDATE notifications SET read = 1 WHERE user_email = ? AND read = 0").run(req.user.email);
  res.json({ success: true });
});

router.get('/pending-payments', async (req, res) => {
  const db = getDb();
  const pending = await db.prepare("SELECT * FROM pending_payments WHERE customer_email = ? AND status = 'pending'").all(req.user.email);
  res.json(pending);
});

router.post('/report-payment-issue', async (req, res) => {
  const { taskId, reason } = req.body;
  if (!taskId || !reason) return res.status(400).json({ error: 'Missing required fields' });
  const db = getDb();
  const payment = await db.prepare("SELECT * FROM pending_payments WHERE task_id = ? AND customer_email = ? AND status = 'pending'").get(taskId, req.user.email);
  if (!payment) return res.status(404).json({ error: 'Pending payment not found' });
  await db.prepare("UPDATE pending_payments SET status = 'disputed' WHERE id = ?").run(payment.id);
  const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  if (adminEmail) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(adminEmail, '⚠️', 'Payment Dispute', 'Customer ' + req.user.email + ' reported an issue with payment UGX ' + payment.amount + '. Reason: ' + sanitize(reason), 'payment_dispute');
  }
  const prov = await db.prepare("SELECT email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(payment.provider_name, payment.provider_name);
  if (prov) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(prov.email, '⚠️', 'Payment Dispute', 'Customer reported an issue with payment for task #' + taskId + '. Admin will review.', 'payment_dispute');
  }
  res.json({ success: true, message: 'Issue reported. Auto-payment has been halted pending admin review.' });
});

router.post('/cancel-booking/:id', async (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.id);
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return res.json({ success: false, error: 'Task not found' });
  const reason = req.body.reason || 'No reason provided';
  await db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  if (task.provider_id) {
    const prov = await db.prepare("SELECT email FROM providers WHERE id = ?").get(task.provider_id);
    if (prov) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(prov.email, '❌', 'Order Cancelled by Customer', 'Order #' + taskId + ' (' + task.service_name + ') was cancelled. Reason: ' + reason, 'cancellation');
    }
  }
  res.json({ success: true, message: 'Booking cancelled' });
});

router.post('/delete-notification/:id', async (req, res) => {
  const db = getDb();
  await db.prepare('DELETE FROM notifications WHERE id = ? AND user_email = ?').run(parseInt(req.params.id), req.user.email);
  res.json({ success: true });
});

module.exports = router;
