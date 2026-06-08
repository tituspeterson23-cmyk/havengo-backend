const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_j1DzgMkZf5UW@ep-rough-waterfall-altogw50.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require';

let pool;

class StatementWrapper {
  constructor(pool, text) {
    this.pool = pool;
    this.text = text;
  }

  _convert(params) {
    let i = 0;
    return this.text.replace(/\?/g, () => `$${++i}`);
  }

  async run(...params) {
    const sql = this._convert(params);
    const result = await this.pool.query(sql, params);
    const ret = { changes: result.rowCount };
    if (result.rows && result.rows.length > 0) {
      ret.id = result.rows[0].id;
      ret.rows = result.rows;
    }
    return ret;
  }

  async get(...params) {
    const sql = this._convert(params);
    const result = await this.pool.query(sql, params);
    return result.rows.length > 0 ? result.rows[0] : undefined;
  }

  async all(...params) {
    const sql = this._convert(params);
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  pluck() {
    const self = this;
    return {
      get: async (...params) => {
        const sql = self._convert(params);
        const result = await self.pool.query(sql, params);
        if (result.rows.length === 0) return undefined;
        const vals = Object.values(result.rows[0]);
        return vals.length > 0 ? vals[0] : undefined;
      },
      all: async (...params) => {
        const sql = self._convert(params);
        const result = await self.pool.query(sql, params);
        return result.rows.map(row => {
          const vals = Object.values(row);
          return vals.length > 0 ? vals[0] : undefined;
        });
      }
    };
  }
}

function getDb() {
  return pool;
}

// Monkey-patch prepare onto pool so route files can call db.prepare(sql)
function patchPool(p) {
  p.prepare = (text) => new StatementWrapper(p, text);
}

async function initDatabase() {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  patchPool(pool);

  // Test connection
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('Connected to PostgreSQL');
  } finally {
    client.release();
  }

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      firstname TEXT NOT NULL,
      lastname TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bitmoji TEXT DEFAULT '😊',
      balance REAL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS providers (
      id SERIAL PRIMARY KEY,
      firstname TEXT NOT NULL,
      lastname TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      business_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      services TEXT NOT NULL,
      location TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      experience INTEGER DEFAULT 0,
      bitmoji TEXT DEFAULT '🔧',
      verified INTEGER DEFAULT 0,
      total_earnings REAL DEFAULT 0,
      registration_fee_paid INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      customer_email TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      provider_name TEXT,
      provider_id INTEGER,
      provider_email TEXT,
      price REAL NOT NULL,
      status TEXT DEFAULT 'pending_confirmation',
      address TEXT,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS completed_tasks (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL,
      customer_email TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_id INTEGER,
      service_name TEXT NOT NULL,
      price REAL NOT NULL,
      completed_at TIMESTAMPTZ DEFAULT NOW(),
      paid INTEGER DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_payments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL,
      customer_email TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_id INTEGER,
      amount REAL NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'pending'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      message TEXT NOT NULL,
      encrypted INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_email TEXT,
      icon TEXT,
      title TEXT,
      message TEXT,
      type TEXT DEFAULT 'general',
      read INTEGER DEFAULT 0,
      expiry TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS price_requests (
      id SERIAL PRIMARY KEY,
      provider_name TEXT NOT NULL,
      provider_id INTEGER,
      service_id TEXT NOT NULL,
      current_price REAL NOT NULL,
      requested_price REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_prices (
      service_id TEXT PRIMARY KEY,
      price INTEGER NOT NULL,
      provider_id INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deletion_requests (
      id SERIAL PRIMARY KEY,
      identifier TEXT NOT NULL,
      type TEXT NOT NULL,
      requested_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_ratings (
      id SERIAL PRIMARY KEY,
      provider_id INTEGER NOT NULL,
      provider_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      service_name TEXT,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_addresses (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      label TEXT,
      address TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id SERIAL PRIMARY KEY,
      identifier TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT DEFAULT 'email',
      expires_at TIMESTAMPTZ NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Add loyalty_points column to users
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_points INTEGER DEFAULT 0").catch(function(e) {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'monthly',
      amount REAL NOT NULL DEFAULT 0,
      discount_percent INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      next_billing_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      cancelled_at TIMESTAMPTZ,
      provider_id INTEGER,
      provider_name TEXT,
      days_per_month INTEGER DEFAULT 30,
      exact_days TEXT
    )
  `);
  await pool.query("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_id INTEGER").catch(function(e) {});
  await pool.query("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_name TEXT").catch(function(e) {});
  await pool.query("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS days_per_month INTEGER DEFAULT 30").catch(function(e) {});
  await pool.query("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS exact_days TEXT").catch(function(e) {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_prices (
      id SERIAL PRIMARY KEY,
      service_id TEXT NOT NULL,
      price REAL NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(service_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_orders (
      id SERIAL PRIMARY KEY,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      service_id TEXT NOT NULL,
      order_date DATE NOT NULL,
      status TEXT DEFAULT 'pending',
      task_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS redeemable_gifts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      points_required INTEGER NOT NULL,
      image TEXT,
      stock INTEGER DEFAULT 999
    )
  `);

  // Seed redeemable gifts if empty
  const giftCount = await pool.query("SELECT COUNT(*) as c FROM redeemable_gifts");
  if (parseInt(giftCount.rows[0].c) === 0) {
    await pool.query("INSERT INTO redeemable_gifts (name, description, points_required, stock) VALUES ($1, $2, $3, $4)", ['HavenGo Branded Mug', 'Stylish ceramic mug with the HavenGo logo', 50, 100]);
    await pool.query("INSERT INTO redeemable_gifts (name, description, points_required, stock) VALUES ($1, $2, $3, $4)", ['HavenGo Jumper', 'Premium quality hoodie with HavenGo branding', 200, 50]);
    await pool.query("INSERT INTO redeemable_gifts (name, description, points_required, stock) VALUES ($1, $2, $3, $4)", ['Free Service Voucher', 'Redeem any single service up to 50,000 UGX for free', 150, 30]);
    await pool.query("INSERT INTO redeemable_gifts (name, description, points_required, stock) VALUES ($1, $2, $3, $4)", ['10% Lifetime Discount Badge', 'Permanent 10% off on all future bookings', 500, 20]);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty_redemptions (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      gift_id INTEGER NOT NULL,
      gift_name TEXT NOT NULL,
      points_spent INTEGER NOT NULL,
      redeemed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracking (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('customer', 'provider')),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Create indexes
  await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_conv ON chat_messages(conversation_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_customer ON tasks(customer_email)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_provider ON tasks(provider_name)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email)');

  // Fix column types for PostgreSQL compatibility (frontend sends string service IDs)
  await pool.query("ALTER TABLE tasks ALTER COLUMN service_id TYPE TEXT USING service_id::text").catch(function(e) { /* column already TEXT */ });
  await pool.query("ALTER TABLE price_requests ALTER COLUMN service_id TYPE TEXT USING service_id::text").catch(function(e) { /* column already TEXT */ });
  // Add provider_email column if not exists (may already exist from new table creation)
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider_email TEXT").catch(function(e) { /* column may already exist */ });
  // Add latitude/longitude for map location
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS latitude REAL").catch(function(e) { /* column may already exist */ });
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS longitude REAL").catch(function(e) { /* column may already exist */ });
  // Add is_subscription_order flag for priority handling
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_subscription_order BOOLEAN DEFAULT false").catch(function(e) { /* column may already exist */ });

  // Session persistence table for refresh tokens
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      token_hash TEXT NOT NULL,
      device_info TEXT,
      ip TEXT,
      fingerprint TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_activity TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked INTEGER DEFAULT 0,
      revoked_at TIMESTAMPTZ
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)');

  // Account lockout columns
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0").catch(function(e) {});
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ").catch(function(e) {});
  await pool.query("ALTER TABLE providers ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0").catch(function(e) {});
  await pool.query("ALTER TABLE providers ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ").catch(function(e) {});

  // 2FA columns for users
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT").catch(function(e) {});
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false").catch(function(e) {});
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT DEFAULT '[]'").catch(function(e) {});
  await pool.query("ALTER TABLE providers ADD COLUMN IF NOT EXISTS totp_secret TEXT").catch(function(e) {});
  await pool.query("ALTER TABLE providers ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false").catch(function(e) {});
  await pool.query("ALTER TABLE providers ADD COLUMN IF NOT EXISTS backup_codes TEXT DEFAULT '[]'").catch(function(e) {});

  // Password history table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id)');

  // Audit log for payment security
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      action TEXT NOT NULL,
      amount INTEGER DEFAULT 0,
      reference TEXT DEFAULT '',
      description TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)');

  // Escrow holds table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS escrow_holds (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      hold_reference TEXT NOT NULL,
      status TEXT DEFAULT 'held',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      released_at TIMESTAMPTZ,
      returned_at TIMESTAMPTZ
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_escrow_order ON escrow_holds(order_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_email)');

  // Seed admin if not exists
  const adminCheck = await pool.query("SELECT id FROM admin_settings WHERE key = 'admin_initialized'");
  if (adminCheck.rows.length === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('23.Forlife', 10);
    await pool.query("INSERT INTO admin_settings (key, value) VALUES ($1, $2)", ['admin_initialized', 'true']);
    await pool.query("INSERT INTO admin_settings (key, value) VALUES ($1, $2)", ['admin_email', 'thermypetson@gmail.com']);
    await pool.query("INSERT INTO admin_settings (key, value) VALUES ($1, $2)", ['admin_phone', '0757532066']);
    await pool.query("INSERT INTO admin_settings (key, value) VALUES ($1, $2)", ['admin_password_hash', hash]);
    console.log('Admin account seeded.');
  }

  // Remove demo provider if present
  const demoDel = await pool.query("DELETE FROM providers WHERE email = 'aisha@havengo.ug'");
  if (demoDel.rowCount > 0) console.log('Demo provider removed.');

  console.log('Database initialized');
  return pool;
}

module.exports = { getDb, initDatabase };
