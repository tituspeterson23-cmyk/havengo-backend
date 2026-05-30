const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate, providerOnly } = require('../middleware/authenticate');
const { hashPassword, sanitize, isValidEmail, isValidPhone, comparePassword } = require('../auth');
const { emitTaskEvent, emitNotification } = require('../firestore-events');
const { JwtHardener, AccountLockout, SessionManager } = require('../security');

const hardener = new JwtHardener();

function getLockout() {
  return new AccountLockout(getDb());
}

function getSessionManager() {
  return new SessionManager(getDb());
}

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

    // Password policy check
    const { PasswordPolicy } = require('../security');
    const policy = new PasswordPolicy();
    const pwCheck = policy.validate(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.errors.join('; ') });
    }

    const db = getDb();
    const existing = await db.prepare('SELECT id FROM providers WHERE email = ? OR phone = ?').get(email, phone);
    if (existing) {
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const hash = await hashPassword(password);
    const servicesStr = Array.isArray(services) ? services.join(',') : services;
    const bm = bitmoji || '🔧';
    const loc = sanitize(location || '');
    const b = sanitize(bio || '');
    const exp = parseInt(experience) || 0;

    await db.prepare('INSERT INTO providers (firstname, lastname, email, phone, business_name, services, password_hash, bitmoji, verified, location, bio, experience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
      .run(sanitize(firstname), sanitize(lastname), sanitize(email), sanitize(phone), sanitize(businessName), servicesStr, hash, bm, loc, b, exp);

    const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
    if (adminEmail) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(adminEmail, '🔧', 'New Provider Application', sanitize(businessName) + ' (' + sanitize(email) + ') applied to join as a provider.', 'provider_signup');
    }

    res.json({ success: true, message: 'Application submitted! Pending admin verification.' });
  } catch (e) {
    console.error('Provider register error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please enter your credentials' });
    }

    const db = getDb();
    const lockout = getLockout();

    // Check if account is locked
    const locked = await lockout.isLocked(identifier);
    if (locked) {
      return res.status(429).json({ error: 'Account temporarily locked due to too many failed attempts. Try again later.' });
    }

    const provider = await db.prepare('SELECT * FROM providers WHERE email = ? OR phone = ?').get(identifier, identifier);
    if (!provider) {
      return res.status(401).json({ user_not_found: true, error: 'Invalid credentials' });
    }
    if (!provider.verified) {
      return res.status(403).json({ error: 'Account pending admin verification' });
    }

    const match = await comparePassword(password, provider.password_hash);
    if (!match) {
      await lockout.recordProviderFailedAttempt(provider.email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Successful login — reset lockout
    await lockout.resetProviderAttempts(provider.email);

    // Check for 2FA
    if (provider.totp_enabled) {
      const tempToken = require('../auth').signToken({ userId: provider.id, email: provider.email, role: 'provider' });
      return res.json({ requiresTwoFactor: true, tempToken, user: { email: provider.email } });
    }

    const accessToken = hardener.signAccessToken(
      { userId: provider.id, email: provider.email, role: 'provider' },
      null
    );
    const refreshToken = hardener.generateRefreshToken();

    // Create session
    const sm = getSessionManager();
    await sm.createSession({
      userId: provider.id,
      email: provider.email,
      role: 'provider',
      tokenHash: refreshToken.tokenHash,
      deviceInfo: req.headers['user-agent'] ? { ua: req.headers['user-agent'] } : {},
      ip: req.ip,
      fingerprint: '',
      expiresAt: refreshToken.expiresAt
    });

    res.json({
      success: true,
      token: accessToken,
      accessToken,
      refreshToken: refreshToken.rawToken,
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

router.use(authenticate, providerOnly);

router.get('/tasks', async (req, res) => {
  const db = getDb();
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const bizName = provider.business_name;
  const fullName = provider.firstname + ' ' + provider.lastname;
  const tasks = await db.prepare("SELECT t.*, u.firstname AS customer_firstname, u.lastname AS customer_lastname, u.phone AS customer_phone FROM tasks t LEFT JOIN users u ON t.customer_email = u.email WHERE (t.provider_id = ? OR t.provider_name = ? OR t.provider_name = ? OR t.provider_email = ? OR t.provider_name = '' OR t.provider_name IS NULL) AND t.status IN ('pending_confirmation', 'active')").all(provider.id, bizName, fullName, provider.email);
  res.json(tasks);
});

router.get('/completed-tasks', async (req, res) => {
  const db = getDb();
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const bizName = provider.business_name;
  const fullName = provider.firstname + ' ' + provider.lastname;
  const completed = await db.prepare('SELECT * FROM completed_tasks WHERE provider_id = ? OR provider_name = ? OR provider_name = ?').all(provider.id, bizName, fullName);
  res.json(completed);
});

router.post('/confirm-task/:taskId', async (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'Invalid task ID' });
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ? AND status = 'pending_confirmation'").get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found or already confirmed' });
  await db.prepare("UPDATE tasks SET status = 'active' WHERE id = ? AND status = 'pending_confirmation'").run(taskId);
  await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(task.customer_email, '✅', 'Order Accepted', 'Your ' + task.service_name + ' order has been accepted by ' + task.provider_name + ' and is now in progress.', 'order');
  emitTaskEvent(taskId, 'order_accepted', { customerEmail: task.customer_email, providerEmail: req.user.email, status: 'active', serviceName: task.service_name });
  emitNotification(task.customer_email, '✅', 'Order Accepted', 'Your ' + task.service_name + ' order has been accepted.', 'order');
  res.json({ success: true, message: 'Task confirmed' });
});

router.post('/complete-task/:taskId', async (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'Invalid task ID' });

  const task = await db.prepare("SELECT * FROM tasks WHERE id = ? AND status = 'active'").get(taskId);
  if (!task) return res.status(404).json({ error: 'Active task not found' });

  const now = new Date().toISOString();
  await db.prepare('INSERT INTO completed_tasks (task_id, customer_email, provider_name, provider_id, service_name, price, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(task.id, task.customer_email, task.provider_name, req.user.providerId, task.service_name, task.price, now);
  await db.prepare('INSERT INTO pending_payments (task_id, customer_email, provider_name, provider_id, amount, completed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(task.id, task.customer_email, task.provider_name, req.user.providerId, task.price, now);
  await db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(task.customer_email, '🎉', 'Task Completed', 'Your ' + task.service_name + ' has been completed by ' + task.provider_name + '. Please confirm payment.', 'order');
  emitTaskEvent(task.id, 'order_completed', { customerEmail: task.customer_email, providerEmail: req.user.email, status: 'completed', serviceName: task.service_name });
  emitNotification(task.customer_email, '🎉', 'Task Completed', 'Your ' + task.service_name + ' has been completed.', 'order');

  res.json({ success: true, message: 'Task marked complete' });
});

router.get('/earnings', async (req, res) => {
  const db = getDb();
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const total = await db.prepare("SELECT COALESCE(SUM(price * 0.85), 0) as earnings FROM completed_tasks WHERE provider_id = ? AND paid = 1").get(provider.id);
  const breakdown = await db.prepare("SELECT service_name, price, completed_at FROM completed_tasks WHERE provider_id = ? AND paid = 1").all(provider.id);
  res.json({ totalEarnings: total.earnings, breakdown });
});

router.post('/price-request', async (req, res) => {
  const { serviceId, currentPrice, requestedPrice } = req.body;
  if (!serviceId || !currentPrice || !requestedPrice) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const db = getDb();
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  var provName = provider.business_name || provider.firstname + ' ' + provider.lastname;
  await db.prepare("INSERT INTO price_requests (provider_name, provider_id, service_id, current_price, requested_price) VALUES (?, ?, ?, ?, ?)")
    .run(provName, provider.id, serviceId, currentPrice, requestedPrice);
  const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  if (adminEmail) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(adminEmail, '💰', 'Price Change Request', provName + ' requests price change for service: UGX ' + currentPrice + ' → UGX ' + requestedPrice, 'price_request');
  }
  res.json({ success: true, message: 'Price change requested' });
});

router.get('/dashboard-stats', async (req, res) => {
  const db = getDb();
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const todayTasks = await db.prepare("SELECT COUNT(*) as count FROM tasks WHERE (provider_id = ? OR provider_id IS NULL) AND created_at::date = CURRENT_DATE").get(provider.id);
  const monthlyEarnings = await db.prepare("SELECT COALESCE(SUM(price * 0.85), 0) as earnings FROM completed_tasks WHERE provider_id = ? AND paid = 1 AND to_char(completed_at, 'YYYY-MM') = to_char(NOW(), 'YYYY-MM')").get(provider.id);
  const totalCompleted = await db.prepare("SELECT COUNT(*) as count FROM completed_tasks WHERE provider_id = ? AND paid = 1").get(provider.id);
  const totalTasks = await db.prepare("SELECT COUNT(*) as count FROM completed_tasks WHERE provider_id = ?").get(provider.id);
  const completionRate = totalTasks.count > 0 ? Math.round((totalCompleted.count / totalTasks.count) * 100) : 0;

  res.json({
    todayTasks: todayTasks.count,
    monthlyEarnings: monthlyEarnings.earnings,
    completionRate
  });
});

router.get('/price-requests', async (req, res) => {
  const db = getDb();
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const requests = await db.prepare("SELECT * FROM price_requests WHERE provider_id = ? ORDER BY created_at DESC").all(provider.id);
  res.json(requests);
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

router.delete('/account', async (req, res) => {
  const db = getDb();
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  await db.prepare('DELETE FROM providers WHERE email = ?').run(req.user.email);
  const bizName = provider.business_name;
  const fullName = provider.firstname + ' ' + provider.lastname;
  await db.prepare("DELETE FROM tasks WHERE provider_name = ? OR provider_name = ?").run(bizName, fullName);
  await db.prepare("DELETE FROM completed_tasks WHERE provider_name = ? OR provider_name = ?").run(bizName, fullName);
  await db.prepare("DELETE FROM pending_payments WHERE provider_name = ? OR provider_name = ?").run(bizName, fullName);
  await db.prepare("DELETE FROM notifications WHERE user_email = ?").run(req.user.email);
  await db.prepare("DELETE FROM chat_messages WHERE conversation_id LIKE ?").run('provider-admin-' + req.user.email + '%');
  await db.prepare("DELETE FROM chat_messages WHERE conversation_id = ? OR conversation_id = ?").run(bizName, fullName);
  res.json({ success: true, message: 'Account deleted' });
});

router.post('/notifications/mark-seen', async (req, res) => {
  const db = getDb();
  await db.prepare("UPDATE notifications SET read = 1 WHERE user_email = ? AND read = 0").run(req.user.email);
  res.json({ success: true });
});

router.post('/pay-registration-fee', async (req, res) => {
  const db = getDb();
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  if (provider.registration_fee_paid) return res.json({ success: true, message: 'Fee already paid' });
  await db.prepare('UPDATE providers SET registration_fee_paid = 1 WHERE email = ?').run(req.user.email);
  await db.prepare("DELETE FROM notifications WHERE user_email = ? AND type = 'provider_verified'").run(req.user.email);
  res.json({ success: true, message: 'Registration fee paid. You can now receive orders.' });
});

router.post('/withdraw', async (req, res) => {
  const { amount } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const db = getDb();
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
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

  await db.prepare('UPDATE providers SET total_earnings = total_earnings - ? WHERE email = ?').run(totalDeduction, req.user.email);
  res.json({ success: true, message: amt + ' UGX withdrawal processed. Fee: ' + fee + ' UGX' });
});

router.post('/cancel-task/:taskId', async (req, res) => {
  const db = getDb();
  const taskId = parseInt(req.params.taskId);
  const { reason } = req.body;
  if (!taskId) return res.status(400).json({ error: 'Invalid task ID' });
  if (!reason) return res.status(400).json({ error: 'Cancellation reason is required' });
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ? AND status IN ('pending_confirmation', 'active')").get(taskId);
  if (!task) return res.status(404).json({ error: 'Active task not found' });
  const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const provName = provider.business_name || provider.firstname + ' ' + provider.lastname;
  // Do NOT cancel directly — send cancel request to admin instead
  const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  if (adminEmail) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
      .run(adminEmail, '🔄', 'Cancel Request', provName + ' requested cancellation of order #' + taskId + ' (' + task.service_name + '). Reason: ' + sanitize(reason) + '.', 'cancel_request');
  }
  try { emitNotification(adminEmail, '🔄', 'Cancel Request', provName + ' requested cancellation of order #' + taskId, 'task'); } catch(e) {}
  res.json({ success: true, message: 'Cancel request sent to admin. Awaiting approval.', reason: reason });
});

module.exports = router;
