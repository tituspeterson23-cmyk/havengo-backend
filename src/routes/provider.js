const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate, providerOnly } = require('../middleware/authenticate');
const { hashPassword, sanitize, isValidEmail, isValidPhone } = require('../auth');

// POST /api/provider/register
router.post('/register', async (req, res) => {
  try {
    const { firstname, lastname, email, phone, businessName, services, password, confirmPassword, bitmoji } = req.body;

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

    db.prepare('INSERT INTO providers (firstname, lastname, email, phone, business_name, services, password_hash, bitmoji, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
      .run(sanitize(firstname), sanitize(lastname), sanitize(email), sanitize(phone), sanitize(businessName), servicesStr, hash, bm);

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
      return res.status(401).json({ error: 'Invalid credentials' });
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
        services: provider.services, bitmoji: provider.bitmoji, total_earnings: provider.total_earnings
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
  const tasks = db.prepare("SELECT * FROM tasks WHERE provider_name = ? AND status IN ('pending_confirmation', 'active')").all(provider.business_name);
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
  const result = db.prepare("UPDATE tasks SET status = 'active' WHERE id = ? AND status = 'pending_confirmation'").run(taskId);
  if (result.changes === 0) return res.status(404).json({ error: 'Task not found or already confirmed' });
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
  // Update task status in completed_tasks (already created above)

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
  const notifs = db.prepare("SELECT * FROM notifications WHERE user_email = ? AND (expiry IS NULL OR expiry > datetime('now')) ORDER BY created_at DESC LIMIT 50").all(req.user.email);
  res.json(notifs);
});

router.post('/notifications/clear', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM notifications WHERE user_email = ?').run(req.user.email);
  res.json({ success: true });
});

module.exports = router;
