const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate, providerOnly } = require('../middleware/authenticate');
const { hashPassword, sanitize, isValidEmail, isValidPhone } = require('../auth');

// POST /api/provider/register
router.post('/register', async (req, res) => {
  try {
    const { firstname, lastname, email, phone, businessName, services, password, confirmPassword, bitmoji, location, bio, experience } = req.body;

    if (!firstname || !lastname || !email || !phone || !businessName || !services || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Phone must be 10 digits starting with 0' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM providers WHERE email = ? OR phone = ?').get(email, phone);
    if (existing) {
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const hash = await hashPassword(password);
    const servicesStr = Array.isArray(services) ? services.join(',') : services;
    const bm = bitmoji || '🔧';
    const loc = sanitize(location || '');
    const b = sanitize(bio || '');
    const exp = parseInt(experience) || 0;

    db.prepare('INSERT INTO providers (firstname, lastname, email, phone, business_name, services, password_hash, bitmoji, verified, location, bio, experience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
      .run(sanitize(firstname), sanitize(lastname), sanitize(email), sanitize(phone), sanitize(businessName), servicesStr, hash, bm, loc, b, exp);

    // Notify admin about new provider signup
    const adminEmail = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
    if (adminEmail) {
      db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(adminEmail, '🔧', 'New Provider Application', sanitize(businessName) + ' (' + sanitize(email) + ') applied to join as a provider.', 'provider_signup');
    }

    res.json({ success: true, message: 'Application submitted! Pending admin verification.' });
  } catch (e) {
    console.error('Provider register error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/provider/login
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please enter your credentials' });
    }

    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE email = ? OR phone = ?').get(identifier, identifier);
    if (!provider) {
      if (req.body.restoring && req.body.firstname && req.body.email && req.body.phone && req.body.businessName && req.body.services) {
        const hash = await hashPassword(password);
        const servicesStr = Array.isArray(req.body.services) ? req.body.services.join(',') : req.body.services;
        db.prepare('INSERT INTO providers (firstname, lastname, email, phone, business_name, services, password_hash, bitmoji, verified, location, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
          .run(sanitize(req.body.firstname), sanitize(req.body.lastname || ''), sanitize(req.body.email), sanitize(req.body.phone), sanitize(req.body.businessName), servicesStr, hash, sanitize(req.body.bitmoji || '🔧'), sanitize(req.body.location || ''), sanitize(req.body.bio || ''));
        const newProvider = db.prepare('SELECT * FROM providers WHERE email = ?').get(sanitize(req.body.email));
        if (newProvider) {
          const { generateToken } = require('../auth');
          const token = generateToken({ email: newProvider.email, role: 'provider', providerId: newProvider.id, firstname: newProvider.firstname });
          return res.json({
            success: true, token,
            provider: {
              id: newProvider.id, firstname: newProvider.firstname, lastname: newProvider.lastname,
              email: newProvider.email, phone: newProvider.phone, business_name: newProvider.business_name,
              services: newProvider.services, bitmoji: newProvider.bitmoji, total_earnings: newProvider.total_earnings,
              location: newProvider.location || '', bio: newProvider.bio || '', experience: newProvider.experience || 0,
              registration_fee_paid: newProvider.registration_fee_paid || 0
            }
          });
        }
      }
      return res.status(401).json({ user_not_found: true, error: 'Invalid credentials' });
    }
    if (!provider.verified) {
      return res.status(403).json({ error: 'Account pending admin verification' });
    }

    const bcrypt = require('bcryptjs');
    const match = await bcrypt.compare(password, provider.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { generateToken } = require('../auth');
    const token = generateToken({ email: provider.email, role: 'provider', providerId: provider.id, firstname: provider.firstname });

    res.json({
      success: true, token,
      provider: {
        id: provider.id, firstname: provider.firstname, lastname: provider.lastname,
        email: provider.email, phone: provider.phone, business_name: provider.business_name,
        services: provider.services, bitmoji: provider.bitmoji, total_earnings: provider.total_earnings,
        location: provider.location || '', bio: provider.bio || '', experience: provider.experience || 0,
        registration_fee_paid: provider.registration_fee_paid || 0
      }
    });
  } catch (e) {
    console.error('Provider login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Middleware for authenticated provider routes
router.use(authenticate, providerOnly);

// GET /api/provider/tasks
router.get('/tasks', (req, res) => {
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const providerName = provider.business_name || (provider.firstname + ' ' + provider.lastname);
  const tasks = db.prepare("SELECT * FROM tasks WHERE (provider_name = ? OR provider_name = '' OR provider_name IS NULL) AND status IN ('pending_confirmation', 'active')").all(providerName);
  res.json(tasks);
});

// GET /api/provider/completed-tasks
router.get('/completed-tasks', (req, res) => {
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const completed = db.prepare('SELECT * FROM completed_tasks WHERE provider_name = ?').all(provider.business_name);
  res.json(completed);
});

// POST /api/provider/confirm-task/:taskId
router.post('/confirm-task/:taskId', (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'Invalid task ID' });
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND status = 'pending_confirmation'").get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found or already confirmed' });
  db.prepare("UPDATE tasks SET status = 'active' WHERE id = ? AND status = 'pending_confirmation'").run(taskId);
  // Notify customer
  db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(task.customer_email, '✅', 'Order Accepted', 'Your ' + task.service_name + ' order has been accepted by ' + task.provider_name + ' and is now in progress.', 'order');
  res.json({ success: true, message: 'Task confirmed' });
});

// POST /api/provider/complete-task/:taskId
router.post('/complete-task/:taskId', (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'Invalid task ID' });

  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND status = 'active'").get(taskId);
  if (!task) return res.status(404).json({ error: 'Active task not found' });

  const now = new Date().toISOString();
  // Move to completed_tasks
  db.prepare('INSERT INTO completed_tasks (task_id, customer_email, provider_name, provider_id, service_name, price, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(task.id, task.customer_email, task.provider_name, req.user.providerId, task.service_name, task.price, now);
  // Create pending payment
  db.prepare('INSERT INTO pending_payments (task_id, customer_email, provider_name, provider_id, amount, completed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(task.id, task.customer_email, task.provider_name, req.user.providerId, task.price, now);
  // Delete original task
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  // Notify customer
  db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(task.customer_email, '🎉', 'Task Completed', 'Your ' + task.service_name + ' has been completed by ' + task.provider_name + '. Please confirm payment.', 'order');

  res.json({ success: true, message: 'Task marked complete' });
});

// GET /api/provider/earnings
router.get('/earnings', (req, res) => {
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const total = db.prepare("SELECT COALESCE(SUM(price * 0.85), 0) as earnings FROM completed_tasks WHERE provider_name = ? AND paid = 1").get(provider.business_name);
  const breakdown = db.prepare("SELECT service_name, price, completed_at FROM completed_tasks WHERE provider_name = ? AND paid = 1").all(provider.business_name);
  res.json({ totalEarnings: total.earnings, breakdown });
});

// POST /api/provider/price-request
router.post('/price-request', (req, res) => {
  const { serviceId, currentPrice, requestedPrice } = req.body;
  if (!serviceId || !currentPrice || !requestedPrice) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  db.prepare("INSERT INTO price_requests (provider_name, provider_id, service_id, current_price, requested_price) VALUES (?, ?, ?, ?, ?)")
    .run(provider.business_name, provider.id, serviceId, currentPrice, requestedPrice);
  // Notify admin
  const adminEmail = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  if (adminEmail) {
    db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(adminEmail, '💰', 'Price Change Request', provider.business_name + ' requests price change for service: UGX ' + currentPrice + ' → UGX ' + requestedPrice, 'price_request');
  }
  res.json({ success: true, message: 'Price change requested' });
});

// GET /api/provider/dashboard-stats
router.get('/dashboard-stats', (req, res) => {
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const todayTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE provider_name = ? AND DATE(created_at) = DATE('now')").get(provider.business_name);
  const monthlyEarnings = db.prepare("SELECT COALESCE(SUM(price * 0.85), 0) as earnings FROM completed_tasks WHERE provider_name = ? AND paid = 1 AND strftime('%Y-%m', completed_at) = strftime('%Y-%m', 'now')").get(provider.business_name);
  const totalCompleted = db.prepare("SELECT COUNT(*) as count FROM completed_tasks WHERE provider_name = ? AND paid = 1").get(provider.business_name);
  const totalTasks = db.prepare("SELECT COUNT(*) as count FROM completed_tasks WHERE provider_name = ?").get(provider.business_name);
  const completionRate = totalTasks.count > 0 ? Math.round((totalCompleted.count / totalTasks.count) * 100) : 0;

  res.json({
    todayTasks: todayTasks.count,
    monthlyEarnings: monthlyEarnings.earnings,
    completionRate
  });
});

// Notifications
router.get('/notifications', (req, res) => {
  const db = getDb();
  const notifs = db.prepare("SELECT * FROM notifications WHERE user_email = ? AND read = 0 AND (expiry IS NULL OR expiry > datetime('now')) ORDER BY created_at DESC LIMIT 50").all(req.user.email);
  res.json(notifs);
});

router.post('/notifications/clear', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM notifications WHERE user_email = ?').run(req.user.email);
  res.json({ success: true });
});

// DELETE /api/provider/account — provider self-deletion
router.delete('/account', (req, res) => {
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  // Delete provider and all associated data
  db.prepare('DELETE FROM providers WHERE email = ?').run(req.user.email);
  db.prepare("DELETE FROM tasks WHERE provider_name = ?").run(provider.business_name);
  db.prepare("DELETE FROM completed_tasks WHERE provider_name = ?").run(provider.business_name);
  db.prepare("DELETE FROM pending_payments WHERE provider_name = ?").run(provider.business_name);
  db.prepare("DELETE FROM notifications WHERE user_email = ?").run(req.user.email);
  // Delete chat messages in provider conversations
  db.prepare("DELETE FROM chat_messages WHERE conversation_id LIKE ?").run('provider-admin-' + req.user.email + '%');
  db.prepare("DELETE FROM chat_messages WHERE conversation_id = ?").run(provider.business_name);
  res.json({ success: true, message: 'Account deleted' });
});

router.post('/notifications/mark-seen', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE notifications SET read = 1 WHERE user_email = ? AND read = 0").run(req.user.email);
  res.json({ success: true });
});

// POST /api/provider/pay-registration-fee
router.post('/pay-registration-fee', (req, res) => {
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  if (provider.registration_fee_paid) return res.json({ success: true, message: 'Fee already paid' });
  db.prepare('UPDATE providers SET registration_fee_paid = 1 WHERE email = ?').run(req.user.email);
  // Clear the verification notification
  db.prepare("DELETE FROM notifications WHERE user_email = ? AND type = 'provider_verified'").run(req.user.email);
  res.json({ success: true, message: 'Registration fee paid. You can now receive orders.' });
});

// POST /api/provider/withdraw
router.post('/withdraw', (req, res) => {
  const { amount } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const availableEarnings = provider.total_earnings || 0;
  if (amt > availableEarnings) {
    return res.status(400).json({ error: 'Insufficient earnings. Available: UGX ' + availableEarnings.toLocaleString() });
  }

  const fee = amt * 0.005;
  const totalDeduction = amt + fee;
  if (totalDeduction > availableEarnings) {
    return res.status(400).json({ error: 'Amount plus fee exceeds available earnings' });
  }

  db.prepare('UPDATE providers SET total_earnings = total_earnings - ? WHERE email = ?').run(totalDeduction, req.user.email);
  res.json({ success: true, message: amt + ' UGX withdrawal processed. Fee: ' + fee + ' UGX' });
});

// POST /api/provider/cancel-task/:taskId — provider cancels order with reason
router.post('/cancel-task/:taskId', (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.taskId);
  const { reason } = req.body;
  if (!taskId) return res.status(400).json({ error: 'Invalid task ID' });
  if (!reason) return res.status(400).json({ error: 'Cancellation reason is required' });
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND status IN ('pending_confirmation', 'active')").get(taskId);
  if (!task) return res.status(404).json({ error: 'Active task not found' });
  const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  // Notify customer
  db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(task.customer_email, '❌', 'Order Cancelled', 'Your ' + task.service_name + ' order was cancelled by ' + provider.business_name + '. Reason: ' + sanitize(reason) + '. Please place with a different provider.', 'order_cancelled');
  res.json({ success: true, message: 'Task cancelled', reason: reason });
});

module.exports = router;
