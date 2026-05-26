const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');

router.get('/', async (req, res) => {
  const db = getDb();
  const reviews = await db.prepare('SELECT id, name, rating, text, created_at FROM reviews ORDER BY created_at DESC').all();
  res.json(reviews);
});

router.post('/', authenticate, async (req, res) => {
  const { rating, text } = req.body;
  if (!rating || !text) return res.status(400).json({ error: 'Rating and text are required' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
  const name = req.user.firstname ? req.user.firstname + ' ' + (req.user.lastname || '') : req.user.email;
  const db = getDb();
  await db.prepare('INSERT INTO reviews (name, email, rating, text) VALUES (?, ?, ?, ?)').run(name, req.user.email, rating, text);
  res.json({ success: true, message: 'Review submitted' });
});

module.exports = router;
