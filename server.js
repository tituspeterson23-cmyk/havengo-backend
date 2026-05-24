require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { initDatabase } = require('./src/database');
const { sanitize } = require('./src/auth');

// Initialize database
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Input sanitization middleware for all request bodies
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        // Don't sanitize password fields - they get hashed anyway
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
app.use('/api/tracking', require('./src/routes/tracking'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public: list verified providers for service listing
app.get('/api/providers/verified', (req, res) => {
  const { getDb } = require('./src/database');
  const db = getDb();
  const providers = db.prepare("SELECT id, firstname, lastname, email, phone, business_name, services, bitmoji, total_earnings, registration_fee_paid FROM providers WHERE verified = 1").all();
  const mapped = providers.map(p => ({
    id: p.id, name: p.firstname + ' ' + p.lastname, business_name: p.business_name,
    email: p.email, phone: p.phone, services: p.services, bitmoji: p.bitmoji,
    jobs: p.total_earnings ? Math.floor(p.total_earnings / 50000) : 0
  }));
  res.json(mapped);
});

// Serve the frontend HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Payment reminder - 2 minutes after task completion, notify customer to pay
setInterval(() => {
  try {
    const db = require('./src/database').getDb();
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    // Find tasks where payment is pending and 2-3 minutes have passed (send reminder once)
    const reminders = db.prepare("SELECT * FROM pending_payments WHERE status = 'pending' AND completed_at < ? AND completed_at > ?").all(twoMinAgo, threeMinAgo);
    for (const p of reminders) {
      db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '⏰', 'Payment Reminder', 'Payment of UGX " + p.amount + " for your task is due. Pay within 10 hours or it will be auto-deducted.', 'payment_reminder')")
        .run(p.customer_email);
      // Also notify provider
      const prov = db.prepare("SELECT email FROM providers WHERE business_name = ?").get(p.provider_name);
      if (prov) {
        db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '⏰', 'Payment Pending', 'Customer payment of UGX " + p.amount + " is due within 10 hours.', 'payment_reminder')")
          .run(prov.email);
      }
    }
  } catch (e) {
    console.error('Payment reminder error:', e);
  }
}, 60000);

// Auto-payment checker - runs every 60 seconds
setInterval(() => {
  try {
    const db = require('./src/database').getDb();
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    const expired = db.prepare("SELECT * FROM pending_payments WHERE status = 'pending' AND completed_at < ?").all(tenHoursAgo);

    for (const payment of expired) {
      // Auto-deduct from customer balance
      const customerAmount = payment.amount;
      const providerAmount = customerAmount * 0.85;
      const systemAmount = customerAmount * 0.15;

      // Mark completed_task as paid
      db.prepare('UPDATE completed_tasks SET paid = 1 WHERE task_id = ?').run(payment.task_id);
      // Update pending payment
      db.prepare("UPDATE pending_payments SET status = 'auto_paid' WHERE id = ?").run(payment.id);
      // Credit provider
      db.prepare('UPDATE providers SET total_earnings = total_earnings + ? WHERE business_name = ?').run(providerAmount, payment.provider_name);

      // Deduct from customer (if possible)
      const customer = db.prepare('SELECT * FROM users WHERE email = ?').get(payment.customer_email);
      if (customer && customer.balance >= customerAmount) {
        db.prepare('UPDATE users SET balance = balance - ? WHERE email = ?').run(customerAmount, payment.customer_email);
      }

      // Notify customer and provider about auto-payment
      db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '⏰', 'Auto-Payment Completed', 'UGX " + payment.amount + " auto-deducted for completed task (10-hour window expired).', 'auto_payment')")
        .run(payment.customer_email);
      const provNotify = db.prepare("SELECT email FROM providers WHERE business_name = ?").get(payment.provider_name);
      if (provNotify) {
        db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, '💰', 'Payment Released', 'UGX " + providerAmount + " credited to your account (auto-payment).', 'auto_payment')")
          .run(provNotify.email);
      }

      console.log('Auto-payment processed for task', payment.task_id);
    }
  } catch (e) {
    console.error('Auto-payment error:', e);
  }
}, 60000);

// Deletion request processor - runs every 5 minutes
setInterval(() => {
  try {
    const db = require('./src/database').getDb();
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const expired = db.prepare("SELECT * FROM deletion_requests WHERE requested_at < ?").all(fifteenDaysAgo);

    for (const del of expired) {
      if (del.type === 'customer') {
        db.prepare('DELETE FROM users WHERE email = ?').run(del.identifier);
      } else if (del.type === 'provider') {
        db.prepare('DELETE FROM providers WHERE email = ?').run(del.identifier);
      }
      db.prepare('DELETE FROM deletion_requests WHERE id = ?').run(del.id);
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

app.listen(PORT, () => {
  console.log(`\nHavenGo Backend running at http://localhost:${PORT}`);
  console.log(`Admin login at http://localhost:${PORT}/`);
  console.log('API endpoints available under /api/');
  console.log('Database: data/havengo.db\n');
});
