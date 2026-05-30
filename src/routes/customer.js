const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { sanitize } = require('../auth');
const { emitTaskEvent, emitNotification } = require('../firestore-events');

router.use(authenticate);

router.get('/profile', async (req, res) => {
  const db = getDb();
  const user = await db.prepare('SELECT id, firstname, lastname, email, phone, bitmoji, balance, loyalty_points, created_at FROM users WHERE email = ?').get(req.user.email);
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
  const { serviceId, serviceName, providerName, price, address, details, latitude, longitude } = req.body;
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
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const validLat = !isNaN(lat) ? lat : null;
  const validLng = !isNaN(lng) ? lng : null;
  // Look up provider_id when provider_name is known
  let providerId = null;
  let providerEmail = null;
  if (pName) {
    const provRow = await db.prepare("SELECT id, email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(pName, pName);
    if (provRow) { providerId = provRow.id; providerEmail = provRow.email; }
  }
  const inserted = await db.prepare('INSERT INTO tasks (customer_email, service_id, service_name, provider_name, provider_id, provider_email, price, status, address, details, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .get(req.user.email, serviceId, sanitize(serviceName), sanitize(pName), providerId, providerEmail, price, 'pending_confirmation', sanitize(address || ''), sanitize(details || ''), validLat, validLng);
  const newTaskId = inserted.id;

  if (!pName) {
    const providers = await db.prepare("SELECT id, business_name, email FROM providers WHERE services LIKE ? AND verified = 1").all(`%${sanitize(serviceName)}%`);
    if (providers.length > 0) {
      await db.prepare("UPDATE tasks SET provider_name = ?, provider_id = ?, provider_email = ? WHERE id = ?")
        .run(providers[0].business_name, providers[0].id, providers[0].email, newTaskId);
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

  // Firestore real-time events
  const provEmail = assignedTask ? assignedTask.provider_name : (providerEmail || '');
  emitTaskEvent(newTaskId, 'order_placed', { customerEmail: req.user.email, providerEmail: provEmail, status: 'pending_confirmation', serviceName: sanitize(serviceName) });
  emitNotification(req.user.email, '📋', 'Order Placed', 'Your ' + sanitize(serviceName) + ' order #' + newTaskId + ' has been placed.', 'order');
  if (prov && prov.email) emitNotification(prov.email, '📋', 'New Order', 'New ' + sanitize(serviceName) + ' order #' + newTaskId + ' assigned to you.', 'order');

  res.json({ success: true, message: 'Order placed! Awaiting provider confirmation.', taskId: newTaskId, providerId: providerId || null, providerEmail: providerEmail || '' });
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

  // Award loyalty points (10 points per 100k = 1 point per 10k UGX)
  const pointsAwarded = Math.floor(completed.price / 10000);
  if (pointsAwarded > 0) {
    await db.prepare('UPDATE users SET loyalty_points = loyalty_points + ? WHERE email = ?').run(pointsAwarded, req.user.email);
  }

  await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '💰', 'Payment Confirmed', 'Payment of " + completed.price + " UGX completed. Provider credited " + providerAmount + " UGX." + (pointsAwarded > 0 ? " +" + pointsAwarded + " loyalty points." : "") + "', 'money')")
    .run(req.user.email);
  const prov = await db.prepare("SELECT email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(completed.provider_name, completed.provider_name);
  if (prov) {
    await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '💰', 'Payment Received', 'Payment of " + completed.price + " UGX received from " + req.user.email + " for " + completed.service_name + ".', 'money')")
      .run(prov.email);
  }

  res.json({ success: true, message: 'Payment confirmed!', providerAmount, systemAmount, pointsAwarded });
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

  const activeCount = await db.prepare("SELECT COUNT(*) as count FROM tasks WHERE customer_email = ? AND status IN ('pending_confirmation', 'active')").get(req.user.email);
  if (activeCount.count > 0) {
    return res.status(400).json({ error: 'Cannot withdraw while you have a pending or active order' });
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

// ============================================================
// SUBSCRIPTION ROUTES
// ============================================================

router.get('/subscriptions', async (req, res) => {
  const db = getDb();
  const subs = await db.prepare("SELECT * FROM subscriptions WHERE user_email = ? AND status = 'active'").all(req.user.email);
  res.json(subs);
});

router.post('/subscriptions/create', async (req, res) => {
  const { serviceId, serviceName, amount, discountPercent } = req.body;
  if (!serviceId || !serviceName) return res.status(400).json({ error: 'Missing required fields' });
  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(req.user.email);
  if (!user) return res.status(401).json({ session_expired: true, error: 'Session expired' });
  if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance for subscription' });
  // Deduct first month
  await db.prepare('UPDATE users SET balance = balance - ? WHERE email = ?').run(amount, req.user.email);
  const nextBilling = new Date();
  nextBilling.setMonth(nextBilling.getMonth() + 1);
  await db.prepare("INSERT INTO subscriptions (user_email, service_id, service_name, plan, amount, discount_percent, status, next_billing_at) VALUES (?, ?, ?, 'monthly', ?, ?, 'active', ?)")
    .run(req.user.email, serviceId, sanitize(serviceName), amount, discountPercent || 0, nextBilling.toISOString());
  res.json({ success: true, message: 'Subscribed to ' + serviceName + ' monthly for UGX ' + amount });
});

router.post('/subscriptions/cancel', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing subscription ID' });
  const db = getDb();
  await db.prepare("UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE id = ? AND user_email = ?").run(parseInt(id), req.user.email);
  res.json({ success: true, message: 'Subscription cancelled' });
});

// ============================================================
// LOYALTY POINTS ROUTES
// ============================================================

router.get('/loyalty-points', async (req, res) => {
  const db = getDb();
  const user = await db.prepare('SELECT loyalty_points FROM users WHERE email = ?').get(req.user.email);
  res.json({ points: user ? user.loyalty_points : 0 });
});

router.get('/gifts', async (req, res) => {
  const db = getDb();
  const gifts = await db.prepare("SELECT * FROM redeemable_gifts WHERE stock > 0").all();
  res.json(gifts);
});

router.get('/redemptions', async (req, res) => {
  const db = getDb();
  const redemptions = await db.prepare("SELECT * FROM loyalty_redemptions WHERE user_email = ? ORDER BY redeemed_at DESC").all(req.user.email);
  res.json(redemptions);
});

router.post('/redeem-gift', async (req, res) => {
  const { giftId } = req.body;
  if (!giftId) return res.status(400).json({ error: 'Missing gift ID' });
  const db = getDb();
  const gift = await db.prepare('SELECT * FROM redeemable_gifts WHERE id = ? AND stock > 0').get(parseInt(giftId));
  if (!gift) return res.status(404).json({ error: 'Gift not found or out of stock' });
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(req.user.email);
  if (!user) return res.status(401).json({ session_expired: true, error: 'Session expired' });
  if ((user.loyalty_points || 0) < gift.points_required) return res.status(400).json({ error: 'Insufficient points' });
  await db.prepare('UPDATE users SET loyalty_points = loyalty_points - ? WHERE email = ?').run(gift.points_required, req.user.email);
  await db.prepare('UPDATE redeemable_gifts SET stock = stock - 1 WHERE id = ?').run(parseInt(giftId));
  await db.prepare("INSERT INTO loyalty_redemptions (user_email, gift_id, gift_name, points_spent) VALUES (?, ?, ?, ?)")
    .run(req.user.email, parseInt(giftId), gift.name, gift.points_required);
  await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '🎁', 'Gift Redeemed', 'You redeemed: " + gift.name + " for " + gift.points_required + " points.', 'loyalty')")
    .run(req.user.email);
  res.json({ success: true, message: 'Gift redeemed: ' + gift.name, giftName: gift.name });
});

// Add points on confirmed payment
async function awardPoints(email, paidAmount, db) {
  const points = Math.floor(paidAmount / 10000); // 10 points per 100k = 1 point per 10k
  if (points > 0) {
    await db.prepare('UPDATE users SET loyalty_points = loyalty_points + ? WHERE email = ?').run(points, email);
  }
}

// Hook into confirm-payment to award points
const originalConfirmPayment = router.post.bind(router, '/confirm-payment');
// We patch the existing confirm-payment endpoint by using middleware approach
// Actually, let's modify the existing handler directly - the function is defined above.
// We'll need to modify the handler in-place.

module.exports = router;
