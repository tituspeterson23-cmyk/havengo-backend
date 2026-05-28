require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { initDatabase, getDb } = require('./src/database');
const { sanitize } = require('./src/auth');
const { initFirebaseAdmin } = require('./src/firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ['https://havengo-chat.web.app', 'https://havengo.netlify.app', 'https://havengo-backend.onrender.com'], credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Input sanitization middleware for all request bodies
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        if (!key.toLowerCase().includes('password')) {
          req.body[key] = sanitize(req.body[key]);
        }
      }
    }
  }
  next();
});

// Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/provider', require('./src/routes/provider'));
app.use('/api/customer', require('./src/routes/customer'));
app.use('/api/chat', require('./src/routes/chat'));
app.use('/api/reviews', require('./src/routes/reviews'));
app.use('/api/provider-ratings', require('./src/routes/provider-ratings'));
app.use('/api/tracking', require('./src/routes/tracking'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public: get approved service prices for cross-device sync
app.get('/api/services/prices', async (req, res) => {
  const db = getDb();
  // Query from price_requests (authoritative) — get latest approved price per service
  const prices = await db.prepare(
    "SELECT DISTINCT ON (service_id) service_id, requested_price as price, created_at as updated_at " +
    "FROM price_requests WHERE status = 'approved' ORDER BY service_id, created_at DESC"
  ).all();
  res.json(prices);
});

// Public: list verified providers for service listing
app.get('/api/providers/verified', async (req, res) => {
  const db = getDb();
  const providers = await db.prepare("SELECT p.id, p.firstname, p.lastname, p.email, p.phone, p.business_name, p.services, p.bitmoji, p.total_earnings, p.registration_fee_paid, (SELECT COUNT(*) FROM completed_tasks WHERE provider_id = p.id) as job_count FROM providers p WHERE p.verified = 1").all();
  const mapped = providers.map(p => ({
    id: p.id, name: p.firstname + ' ' + p.lastname, business_name: p.business_name,
    email: p.email, phone: p.phone, services: p.services, bitmoji: p.bitmoji,
    jobs: p.job_count || 0
  }));
  res.json(mapped);
});

// Serve static files (favicon.svg, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Serve the frontend HTML for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Payment reminder interval
setInterval(async () => {
  try {
    const db = getDb();
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const reminders = await db.prepare("SELECT * FROM pending_payments WHERE status = 'pending' AND completed_at < $1 AND completed_at > $2").all(twoMinAgo, threeMinAgo);
    for (const p of reminders) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES ($1, '⏰', 'Payment Reminder', $2, 'payment_reminder')")
        .run(p.customer_email, 'Payment of UGX ' + p.amount + ' for your task is due. Pay within 10 hours or it will be auto-deducted.');
      const prov = await db.prepare("SELECT email FROM providers WHERE business_name = $1 OR (firstname || ' ' || lastname) = $2").get(p.provider_name, p.provider_name);
      if (prov) {
        await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES ($1, '⏰', 'Payment Pending', $2, 'payment_reminder')")
          .run(prov.email, 'Customer payment of UGX ' + p.amount + ' is due within 10 hours.');
      }
    }
  } catch (e) {
    console.error('Payment reminder error:', e);
  }
}, 60000);

// Auto-payment checker
setInterval(async () => {
  try {
    const db = getDb();
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    const expired = await db.prepare("SELECT * FROM pending_payments WHERE status = 'pending' AND completed_at < $1").all(tenHoursAgo);

    for (const payment of expired) {
      const customerAmount = payment.amount;
      const providerAmount = customerAmount * 0.85;
      const systemAmount = customerAmount * 0.15;

      await db.prepare('UPDATE completed_tasks SET paid = 1 WHERE task_id = $1').run(payment.task_id);
      await db.prepare("UPDATE pending_payments SET status = 'auto_paid' WHERE id = $1").run(payment.id);
      await db.prepare('UPDATE providers SET total_earnings = total_earnings + $1 WHERE id = $2').run(providerAmount, payment.provider_id);
      // Track system revenue
      const curSys = await db.prepare("SELECT value FROM admin_settings WHERE key = 'system_balance'").pluck().get();
      await db.prepare("INSERT INTO admin_settings (key, value) VALUES ('system_balance', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(((parseFloat(curSys) || 0) + systemAmount).toString());

      const customer = await db.prepare('SELECT * FROM users WHERE email = $1').get(payment.customer_email);
      if (customer && customer.balance >= customerAmount) {
        await db.prepare('UPDATE users SET balance = balance - $1 WHERE email = $2').run(customerAmount, payment.customer_email);
      }

      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES ($1, '⏰', 'Auto-Payment Completed', $2, 'auto_payment')")
        .run(payment.customer_email, 'UGX ' + payment.amount + ' auto-deducted for completed task (10-hour window expired).');
      const provNotify = await db.prepare("SELECT email FROM providers WHERE business_name = $1 OR (firstname || ' ' || lastname) = $2").get(payment.provider_name, payment.provider_name);
      if (provNotify) {
        await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES ($1, '💰', 'Payment Released', $2, 'auto_payment')")
          .run(provNotify.email, 'UGX ' + providerAmount + ' credited to your account (auto-payment).');
      }

      console.log('Auto-payment processed for task', payment.task_id);
    }
  } catch (e) {
    console.error('Auto-payment error:', e);
  }
}, 60000);

// Deletion request processor
setInterval(async () => {
  try {
    const db = getDb();
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const expired = await db.prepare("SELECT * FROM deletion_requests WHERE requested_at < $1").all(fifteenDaysAgo);

    for (const del of expired) {
      if (del.type === 'customer') {
        await db.prepare('DELETE FROM users WHERE email = $1').run(del.identifier);
      } else if (del.type === 'provider') {
        await db.prepare('DELETE FROM providers WHERE email = $1').run(del.identifier);
      }
      await db.prepare('DELETE FROM deletion_requests WHERE id = $1').run(del.id);
      console.log('Account deleted:', del.identifier);
    }
  } catch (e) {
    console.error('Deletion processor error:', e);
  }
}, 300000);

// Create public directory for frontend
const fs = require('fs');
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Write service-account.json from env var if it doesn't exist
const saPath = path.join(__dirname, 'service-account.json');
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  console.log('FIREBASE_SERVICE_ACCOUNT_BASE64 length:', b64.length, 'Last 10 chars:', JSON.stringify(b64.slice(-10)));
  if (!fs.existsSync(saPath)) {
    try {
      const decoded = Buffer.from(b64.trim(), 'base64').toString('utf-8');
      console.log('Decoded JSON length:', decoded.length, 'Last 80 chars:', JSON.stringify(decoded.slice(-80)));
      fs.writeFileSync(saPath, decoded, 'utf-8');
      console.log('Written service-account.json from FIREBASE_SERVICE_ACCOUNT_BASE64');
    } catch (e) {
      console.log('Could not decode FIREBASE_SERVICE_ACCOUNT_BASE64:', e.message);
    }
  }
}

// Start server after database is initialized
(async () => {
  try {
    await initDatabase();
    initFirebaseAdmin();
    app.listen(PORT, () => {
      console.log(`\nHavenGo Backend running at http://localhost:${PORT}`);
      console.log(`Admin login at http://localhost:${PORT}/`);
      console.log('API endpoints available under /api/');
      console.log('Connected to PostgreSQL (Neon)\n');
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
