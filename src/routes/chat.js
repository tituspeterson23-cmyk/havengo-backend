const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { sanitize, encrypt, decrypt } = require('../auth');

router.use(authenticate);

// GET /api/chat/:conversationId
router.get('/:conversationId', (req, res) => {
  const convId = req.params.conversationId;
  const db = getDb();
  // Auth check: only allow users to read their own conversations
  if (req.user.role === 'customer') {
    if (!convId.startsWith('customer-admin-' + req.user.email)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else if (req.user.role === 'provider') {
    const provider = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
    if (!provider) return res.status(403).json({ error: 'Forbidden' });
    if (convId.startsWith('provider-admin-' + req.user.email)) {
      // own admin chat — allowed
    } else if (!convId.startsWith('customer-admin-') && !convId.startsWith('provider-admin-')) {
      // task-based conversation — verify provider is assigned to the task
      const taskId = parseInt(convId, 10);
      if (isNaN(taskId)) return res.status(403).json({ error: 'Forbidden' });
      const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND (provider_name = ? OR provider_name = ?)").get(taskId, provider.business_name, provider.firstname + ' ' + provider.lastname);
      if (!task) return res.status(403).json({ error: 'Forbidden' });
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const messages = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(convId);
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
  // Auth check
  if (req.user.role === 'customer') {
    if (!conversationId.startsWith('customer-admin-' + req.user.email)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else if (req.user.role === 'provider') {
    const db2 = getDb();
    const prov = db2.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
    if (!prov) return res.status(403).json({ error: 'Forbidden' });
    if (conversationId.startsWith('provider-admin-' + req.user.email)) {
      // own admin chat — allowed
    } else if (!conversationId.startsWith('customer-admin-') && !conversationId.startsWith('provider-admin-')) {
      const taskId = parseInt(conversationId, 10);
      if (isNaN(taskId)) return res.status(403).json({ error: 'Forbidden' });
      const task = db2.prepare("SELECT * FROM tasks WHERE id = ? AND (provider_name = ? OR provider_name = ?)").get(taskId, prov.business_name, prov.firstname + ' ' + prov.lastname);
      if (!task) return res.status(403).json({ error: 'Forbidden' });
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const s = sender || req.user.firstname || req.user.email;
  const db = getDb();
  const encrypted = encrypt(message);
  db.prepare('INSERT INTO chat_messages (conversation_id, sender, message, encrypted) VALUES (?, ?, ?, 1)')
    .run(conversationId, sanitize(s), encrypted);
  // Route notification to the right person based on conversation type
  const adminEmail = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  const convTaskId = parseInt(conversationId, 10);
  if (!isNaN(convTaskId)) {
    // Task-based conversation — notify the other party
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(convTaskId);
    if (task) {
      if (sender === 'Customer' || s === 'Customer') {
        // Customer sent message → notify provider
        const prov = db.prepare("SELECT email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(task.provider_name, task.provider_name);
        if (prov) {
          db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
            .run(prov.email, '💬', 'New Message from Customer', task.customer_email + ' sent a message about ' + (task.service_name || 'your order'), 'chat');
        }
      } else {
        // Provider sent message → notify customer
        db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
          .run(task.customer_email, '💬', 'New Message from Provider', 'Your provider sent a message about ' + (task.service_name || 'your order'), 'chat');
      }
    }
  } else if (conversationId.startsWith('customer-admin-')) {
    // Customer-admin conversation → notify admin
    if (adminEmail) {
      db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(adminEmail, '💬', 'New Customer Message', (req.user.email || 'Customer') + ' sent a message', 'chat');
    }
  } else if (conversationId.startsWith('provider-admin-')) {
    // Provider-admin conversation → notify admin
    if (adminEmail) {
      db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(adminEmail, '💬', 'New Provider Message', (req.user.email || 'Provider') + ' sent a message', 'chat');
    }
  }
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
  const convId = req.params.conversationId;
  const db = getDb();
  // Auth check
  if (req.user.role === 'customer') {
    if (!convId.startsWith('customer-admin-' + req.user.email)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else if (req.user.role === 'provider') {
    const prov = db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
    if (!prov) return res.status(403).json({ error: 'Forbidden' });
    if (convId.startsWith('provider-admin-' + req.user.email)) {
      // own admin chat — allowed
    } else if (!convId.startsWith('customer-admin-') && !convId.startsWith('provider-admin-')) {
      const taskId = parseInt(convId, 10);
      if (isNaN(taskId)) return res.status(403).json({ error: 'Forbidden' });
      const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND (provider_name = ? OR provider_name = ?)").get(taskId, prov.business_name, prov.firstname + ' ' + prov.lastname);
      if (!task) return res.status(403).json({ error: 'Forbidden' });
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?').get(req.params.messageId, convId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(req.params.messageId);
  res.json({ success: true });
});

module.exports = router;
