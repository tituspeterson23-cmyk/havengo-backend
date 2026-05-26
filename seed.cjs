const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { initDatabase, getDb } = require('./src/database');

async function seed() {
  await initDatabase();
  console.log('Database initialized. Use the admin panel to create providers.');
  process.exit(0);
}

seed().catch(e => { console.error('Seed failed:', e); process.exit(1); });
