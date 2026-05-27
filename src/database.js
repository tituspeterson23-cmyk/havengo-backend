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
    return { changes: result.rowCount };
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
