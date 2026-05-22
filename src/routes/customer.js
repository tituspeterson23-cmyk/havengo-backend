const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { sanitize } = require('../auth');

// All customer routes require authentication
router.use(authenticate);

// GET /api/customer/profile
router.get('/profile', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, firstname, lastname, email, phone, bitmoji, balance, created_at FROM users WHERE email = ?').get(req.user.email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// POST /api/customer/update-profile
router.post('/update-profile', (req, res) => {
  const { firstname, lastname, bitmoji } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET firstname = ?, lastname = ?, bitmoji = ? WHERE email = ?')
    .run(sanitize(firstname || ''), sanitize(lastname || ''), bitmoji || '😊', req.user.email);
  res.json({ success: true });
});

// GET /api/customer/bookings
router.get('/bookings', (req, res) => {
  const db = getDb();
  const activeTasks = db.prepare("SELECT * FROM tasks WHERE customer_email = ? AND status IN ('pending_confirmation', 'active')").all(req.user.email);
  const completedTasks = db.prepare('SELECT * FROM completed_tasks WHERE customer_email = ?').all(req.user.email);
  res.json({ active: activeTasks, completed: completedTasks });
});

// POST /api/customer/place-order
router.post('/place-order', (req, res) => {
  const { serviceId, serviceName, providerName, price, address, details } = req.body;
  if (!serviceId || !serviceName || !price) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(req.user.email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.balance < price) {
    return res.status(400).json({ error: 'Insufficient balance. Please deposit first.' });
  }

  // Deduct balance
  db.prepare('UPDATE users SET balance = balance - ? WHERE email = ?').run(price, req.user.email);

  // Create task
  const pName = providerName || '';
  db.prepare('INSERT INTO tasks (customer_email, service_id, service_name, provider_name, price, status, address, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.email, serviceId, sanitize(serviceName), sanitize(pName), price, 'pending_confirmation', sanitize(address || ''), sanitize(details || ''));

  // Try to find a matching provider if not assigned
  if (!pName) {
    const providers = db.prepare("SELECT business_name FROM providers WHERE services LIKE ? AND verified = 1").all(`%${sanitize(serviceName)}%`);
    if (providers.length > 0) {
      db.prepare("UPDATE tasks SET provider_name = ? WHERE id = (SELECT MAX(id) FROM tasks WHERE customer_email = ?)")
        .run(providers[0].business_name, req.user.email);
    }
  }

  res.json({ success: true, message: 'Order placed! Awaiting provider confirmation.' });
});

// POST /api/customer/confirm-payment
router.post('/confirm-payment', (req, res) => {
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ error: 'Missing task ID' });

  const db = getDb();
  const completed = db.prepare('SELECT * FROM completed_tasks WHERE task_id = ? AND customer_email = ? AND paid = 0').get(taskId, req.user.email);

  if (!completed) return res.status(404).json({ error: 'Completed task not found or already paid' });

  const providerAmount = completed.price * 0.85;
  const systemAmount = completed.price * 0.15;

  // Mark as paid
  db.prepare('UPDATE completed_tasks SET paid = 1 WHERE task_id = ?').run(taskId);
  // Update pending payments
  db.prepare("UPDATE pending_payments SET status = 'paid' WHERE task_id = ?").run(taskId);
  // Credit provider earnings
  db.prepare('UPDATE providers SET total_earnings = total_earnings + ? WHERE business_name = ?').run(providerAmount, completed.provider_name);

  // Add notifications
  db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '💰', 'Payment Confirmed', 'Payment of " + completed.price + " UGX completed. Provider credited " + providerAmount + " UGX.', 'money')")
    .run(req.user.email);

  res.json({ success: true, message: 'Payment confirmed!', providerAmount, systemAmount });
});

// POST /api/customer/deposit
router.post('/deposit', (req, res) => {
  const { amount } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const db = getDb();
  db.prepare('UPDATE users SET balance = balance + ? WHERE email = ?').run(amt, req.user.email);
  res.json({ success: true, message: amt + ' UGX deposited' });
});

// POST /api/customer/withdraw
router.post('/withdraw', (req, res) => {
  const { amount } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(req.user.email);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Check for pending payments
  const pendingCount = db.prepare("SELECT COUNT(*) as count FROM pending_payments WHERE customer_email = ? AND status = 'pending'").get(req.user.email);
  if (pendingCount.count > 0) {
    return res.status(400).json({ error: 'Cannot withdraw with pending payments' });
  }

  const fee = amt * 0.005;
  const totalDeduction = amt + fee;
  if (user.balance < totalDeduction) {
    return res.status(400).json({ error: 'Insufficient balance including withdrawal fee' });
  }

  db.prepare('UPDATE users SET balance = balance - ? WHERE email = ?').run(totalDeduction, req.user.email);
  res.json({ success: true, message: amt + ' UGX withdrawn. Fee: ' + fee + ' UGX' });
});

// Addresses
router.get('/addresses', (req, res) => {
  const db = getDb();
  const addresses = db.prepare('SELECT * FROM user_addresses WHERE user_email = ?').all(req.user.email);
  res.json(addresses);
});

router.post('/addresses', (req, res) => {
  const { label, address } = req.body;
  if (!address) return res.status(400).json({ error: 'Address is required' });
  const db = getDb();
  db.prepare('INSERT INTO user_addresses (user_email, label, address) VALUES (?, ?, ?)')
    .run(req.user.email, sanitize(label || ''), sanitize(address));
  res.json({ success: true });
});

router.delete('/addresses/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM user_addresses WHERE id = ? AND user_email = ?').run(parseInt(req.params.id), req.user.email);
  res.json({ success: true });
});

// Account deletion
router.post('/request-deletion', (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM deletion_requests WHERE identifier = ? AND type = 'customer'").get(req.user.email);
  if (existing) return res.status(409).json({ error: 'Deletion already requested' });
  db.prepare("INSERT INTO deletion_requests (identifier, type) VALUES (?, 'customer')").run(req.user.email);
  res.json({ success: true, message: 'Deletion requested. 15-day grace period active.' });
});

router.post('/cancel-deletion', (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM deletion_requests WHERE identifier = ? AND type = 'customer'").run(req.user.email);
  res.json({ success: true, message: 'Deletion cancelled' });
});

// Notifications
router.get('/notifications', (req, res) => {
  const db = getDb();
  const notifs = db.prepare("SELECT * FROM notifications WHERE user_email = ? AND (expiry IS NULL OR expiry > datetime('now')) ORDER BY created_at DESC LIMIT 50").all(req.user.email);
  res.json(notifs);
});

router.post('/notifications/clear', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM notifications WHERE user_email = ?').run(req.user.email);
  res.json({ success: true });
});

// GET /api/customer/pending-payments
router.get('/pending-payments', (req, res) => {
  const db = getDb();
  const pending = db.prepare("SELECT * FROM pending_payments WHERE customer_email = ? AND status = 'pending'").all(req.user.email);
  res.json(pending);
});

module.exports = router;
