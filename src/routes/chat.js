const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { sanitize, encrypt, decrypt } = require('../auth');

router.use(authenticate);

// GET /api/chat/:conversationId
router.get('/:conversationId', (req, res) => {
  const db = getDb();
  const messages = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.conversationId);
  const decrypted = messages.map(m => {
    if (m.encrypted) {
      const dec = decrypt(m.message);
      return { ...m, message: dec || '[encrypted]' };
    }
    return m;
  });
  res.json(decrypted);
});

// POST /api/chat/send
router.post('/send', (req, res) => {
  const { conversationId, message, sender } = req.body;
  if (!conversationId || !message) return res.status(400).json({ error: 'Missing fields' });
  const s = sender || req.user.firstname || req.user.email;
  const db = getDb();
  const encrypted = encrypt(message);
  db.prepare('INSERT INTO chat_messages (conversation_id, sender, message, encrypted) VALUES (?, ?, ?, 1)')
    .run(conversationId, sanitize(s), encrypted);
  res.json({ success: true });
});

// GET /api/chat/conversations/mine
router.get('/conversations/mine', (req, res) => {
  const db = getDb();
  const userEmail = req.user.email;
  // Customer sees their own conversations
  const convs = db.prepare("SELECT DISTINCT conversation_id FROM chat_messages WHERE conversation_id LIKE ? ORDER BY created_at DESC")
    .all(`customer-admin-${userEmail}%`);
  return res.json(convs.map(c => c.conversation_id));
});

// DELETE /api/chat/:conversationId/message/:messageId
router.delete('/:conversationId/message/:messageId', (req, res) => {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?').get(req.params.messageId, req.params.conversationId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(req.params.messageId);
  res.json({ success: true });
});

module.exports = router;
