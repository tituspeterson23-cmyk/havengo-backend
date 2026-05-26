const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { initDatabase, getDb } = require('./src/database');

async function seed() {
  await initDatabase();
  const db = getDb();

  const existing = await db.prepare("SELECT id FROM providers WHERE email = 'aisha@havengo.ug'").get();
  if (existing) {
    await db.prepare("DELETE FROM providers WHERE email = 'aisha@havengo.ug'").run();
    console.log('Demo provider removed.');
  }

  console.log('Database initialized.');
  process.exit(0);
}

seed().catch(e => { console.error('Seed failed:', e); process.exit(1); });
