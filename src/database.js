const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'havengo.db');

let db;
let SQL;

// Compatibility wrapper: sql.js -> better-sqlite3-like API
class StatementWrapper {
  constructor(sqlDb, text) {
    this.sqlDb = sqlDb;
    this.text = text;
  }

  run(...params) {
    try {
      const stmt = this.sqlDb.__prepare(this.text);
      stmt.bind(params);
      stmt.step();
      stmt.free();
      return { changes: 1 };
    } catch (e) {
      const stmt = this.sqlDb.__prepare("SELECT changes() AS c");
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();
      return { changes: row.c || 0 };
    }
  }

  get(...params) {
    try {
      const stmt = this.sqlDb.__prepare(this.text);
      stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return undefined;
    } catch (e) {
      return undefined;
    }
  }

  all(...params) {
    const rows = [];
    try {
      const stmt = this.sqlDb.__prepare(this.text);
      if (params.length > 0) stmt.bind(params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
    } catch (e) {}
    return rows;
  }

  pluck() {
    const self = this;
    return {
      get: (...params) => {
        try {
          const stmt = self.sqlDb.__prepare(self.text);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            const vals = Object.values(row);
            return vals.length > 0 ? vals[0] : undefined;
          }
          stmt.free();
          return undefined;
        } catch (e) {
          return undefined;
        }
      },
      all: (...params) => {
        const rows = [];
        try {
          const stmt = self.sqlDb.__prepare(self.text);
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            const row = stmt.getAsObject();
            const vals = Object.values(row);
            rows.push(vals.length > 0 ? vals[0] : undefined);
          }
          stmt.free();
        } catch (e) {}
        return rows;
      }
    };
  }
}

function getDb() {
  return db;
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('Error saving database:', e.message);
  }
}

// Auto-save every 10 seconds
let saveTimer = null;
function startAutoSave() {
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(saveDb, 10000);
}

async function initDatabase() {
  const sqlJs = await initSqlJs();

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Load existing database or create new
  if (fs.existsSync(DB_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new sqlJs.Database(fileBuffer);
      console.log('Loaded existing database');
    } catch (e) {
      db = new sqlJs.Database();
      console.log('Created new database (error loading existing)');
    }
  } else {
    db = new sqlJs.Database();
    console.log('Created new database');
  }

  // Enable foreign keys
  db.run("PRAGMA foreign_keys = ON");

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firstname TEXT NOT NULL,
      lastname TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bitmoji TEXT DEFAULT '😊',
      balance REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Add location/bio/experience columns if missing (migration for existing DB)
  try { db.run('ALTER TABLE providers ADD COLUMN location TEXT DEFAULT \'\''); } catch(e) {}
  try { db.run('ALTER TABLE providers ADD COLUMN bio TEXT DEFAULT \'\''); } catch(e) {}
  try { db.run('ALTER TABLE providers ADD COLUMN experience INTEGER DEFAULT 0'); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_email TEXT NOT NULL,
      service_id INTEGER NOT NULL,
      service_name TEXT NOT NULL,
      provider_name TEXT,
      provider_id INTEGER,
      price REAL NOT NULL,
      status TEXT DEFAULT 'pending_confirmation',
      address TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_email) REFERENCES users(email)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS completed_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      customer_email TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_id INTEGER,
      service_name TEXT NOT NULL,
      price REAL NOT NULL,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid INTEGER DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pending_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      customer_email TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_id INTEGER,
      amount REAL NOT NULL,
      completed_at DATETIME NOT NULL,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      message TEXT NOT NULL,
      encrypted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
      icon TEXT,
      title TEXT,
      message TEXT,
      type TEXT DEFAULT 'general',
      expiry DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS price_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_name TEXT NOT NULL,
      provider_id INTEGER,
      service_id INTEGER NOT NULL,
      current_price REAL NOT NULL,
      requested_price REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS deletion_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier TEXT NOT NULL,
      type TEXT NOT NULL,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      label TEXT,
      address TEXT NOT NULL,
      FOREIGN KEY (user_email) REFERENCES users(email)
    )
  `);

  // Create indexes
  try { db.run("CREATE INDEX IF NOT EXISTS idx_chat_conv ON chat_messages(conversation_id)"); } catch(e) {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_tasks_customer ON tasks(customer_email)"); } catch(e) {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_tasks_provider ON tasks(provider_name)"); } catch(e) {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email)"); } catch(e) {}

  // Seed admin if not exists
  const stmt = db.prepare("SELECT id FROM admin_settings WHERE key = ?");
  stmt.bind(['admin_initialized']);
  const adminExists = stmt.step();
  stmt.free();

  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('23.Forlife', 10);
    db.run("INSERT INTO admin_settings (key, value) VALUES (?, ?)", ['admin_initialized', 'true']);
    db.run("INSERT INTO admin_settings (key, value) VALUES (?, ?)", ['admin_email', 'thermypetson@gmail.com']);
    db.run("INSERT INTO admin_settings (key, value) VALUES (?, ?)", ['admin_phone', '0757532066']);
    db.run("INSERT INTO admin_settings (key, value) VALUES (?, ?)", ['admin_password_hash', hash]);
    console.log('Admin account seeded.');
    saveDb();
  }

  // Patch db methods for route compatibility
  db.__prepare = db.prepare.bind(db);
  db.prepare = (text) => new StatementWrapper(db, text);

  // Also patch db.run for better-sqlite3 compatibility
  const origRun = db.run.bind(db);
  db.run = (sql, params) => {
    if (params) {
      const stmt = db.__prepare(sql);
      stmt.bind(params);
      try { stmt.step(); } catch(e) {}
      stmt.free();
    } else {
      origRun(sql);
    }
    return { changes: 1 };
  };

  db.exec = (sql) => {
    db.run(sql);
    return db;
  };

  startAutoSave();
  console.log('Database initialized at', DB_PATH);
  return db;
}

// Cleanup on exit
process.on('exit', () => {
  saveDb();
  if (saveTimer) clearInterval(saveTimer);
});
process.on('SIGINT', () => {
  saveDb();
  process.exit(0);
});

module.exports = { getDb, initDatabase, saveDb };
