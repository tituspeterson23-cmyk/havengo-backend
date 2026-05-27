const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');

// GET /api/provider-ratings — public, aggregated ratings by provider
router.get('/', async (req, res) => {
  const db = getDb();
  const ratings = await db.prepare('SELECT provider_id, provider_name, service_name, rating FROM provider_ratings').all();
  res.json(ratings);
});

// POST /api/provider-ratings — authenticated customer submits rating
router.post('/', authenticate, async (req, res) => {
  const { providerId, providerName, serviceName, rating } = req.body;
  if (!providerId || !rating) return res.status(400).json({ error: 'Provider ID and rating are required' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
  const db = getDb();
  // Upsert: replace existing rating from this customer for this provider+service
  const existing = await db.prepare('SELECT id FROM provider_ratings WHERE provider_id = ? AND customer_email = ? AND service_name = ?').get(providerId, req.user.email, serviceName || '');
  if (existing) {
    await db.prepare('UPDATE provider_ratings SET rating = ? WHERE id = ?').run(rating, existing.id);
  } else {
    await db.prepare('INSERT INTO provider_ratings (provider_id, provider_name, customer_email, service_name, rating) VALUES (?, ?, ?, ?, ?)').run(providerId, providerName || '', req.user.email, serviceName || '', rating);
  }
  res.json({ success: true, message: 'Rating submitted' });
});

module.exports = router;
