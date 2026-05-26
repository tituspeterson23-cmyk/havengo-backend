const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { initDatabase, getDb } = require('./src/database');
const bcrypt = require('bcryptjs');

async function seed() {
  await initDatabase();
  const db = getDb();

  // Check if demo provider exists
  const existing = await db.prepare("SELECT id FROM providers WHERE email = 'aisha@havengo.ug'").get();
  if (existing) {
    console.log('Demo provider already exists, skipping seed.');
    process.exit(0);
  }

  const hash = bcrypt.hashSync('password', 10);

  // Demo provider
  await db.prepare(`INSERT INTO providers (firstname, lastname, email, phone, business_name, services, password_hash, bitmoji, verified, location, bio, experience, registration_fee_paid)
    VALUES ('Aisha', 'Nabbanja', 'aisha@havengo.ug', '0777123456', 'Aisha Home Services', 'cleaning,spa,family', $1, '🔧', 1, 'Kampala', 'Professional home service provider with 5+ years experience', 5, 1)`)
    .run(hash);

  console.log('Demo provider seeded: aisha@havengo.ug / password');
  process.exit(0);
}

seed().catch(e => { console.error('Seed failed:', e); process.exit(1); });
