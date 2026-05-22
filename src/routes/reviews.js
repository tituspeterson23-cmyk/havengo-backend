const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');

// GET /api/reviews - public, no auth required
router.get('/', (req, res) => {
  const db = getDb();
  const reviews = db.prepare('SELECT id, name, rating, text, created_at FROM reviews ORDER BY created_at DESC').all();
  res.json(reviews);
});

// POST /api/reviews - requires auth
router.post('/', authenticate, (req, res) => {
  const { rating, text } = req.body;
  if (!rating || !text) return res.status(400).json({ error: 'Rating and text are required' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
  const name = req.user.firstname ? req.user.firstname + ' ' + (req.user.lastname || '') : req.user.email;
  const db = getDb();
  db.prepare('INSERT INTO reviews (name, email, rating, text) VALUES (?, ?, ?, ?)').run(name, req.user.email, rating, text);
  res.json({ success: true, message: 'Review submitted' });
});

module.exports = router;
