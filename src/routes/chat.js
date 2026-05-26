const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { sanitize, encrypt, decrypt } = require('../auth');

router.use(authenticate);

router.get('/:conversationId', async (req, res) => {
  const convId = req.params.conversationId;
  const db = getDb();
  if (req.user.role === 'customer') {
    if (!convId.startsWith('customer-admin-' + req.user.email)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else if (req.user.role === 'provider') {
    const provider = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
    if (!provider) return res.status(403).json({ error: 'Forbidden' });
    if (convId.startsWith('provider-admin-' + req.user.email)) {
    } else if (!convId.startsWith('customer-admin-') && !convId.startsWith('provider-admin-')) {
      const taskId = parseInt(convId, 10);
      if (isNaN(taskId)) return res.status(403).json({ error: 'Forbidden' });
      const task = await db.prepare("SELECT * FROM tasks WHERE id = ? AND (provider_name = ? OR provider_name = ?)").get(taskId, provider.business_name, provider.firstname + ' ' + provider.lastname);
      if (!task) return res.status(403).json({ error: 'Forbidden' });
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const messages = await db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(convId);
  const decrypted = messages.map(m => {
    if (m.encrypted) {
      const dec = decrypt(m.message);
      return { ...m, message: dec || '[encrypted]' };
    }
    return m;
  });
  res.json(decrypted);
});

router.post('/send', async (req, res) => {
  const { conversationId, message, sender } = req.body;
  if (!conversationId || !message) return res.status(400).json({ error: 'Missing fields' });
  if (req.user.role === 'customer') {
    if (!conversationId.startsWith('customer-admin-' + req.user.email)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else if (req.user.role === 'provider') {
    const db2 = getDb();
    const prov = await db2.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
    if (!prov) return res.status(403).json({ error: 'Forbidden' });
    if (conversationId.startsWith('provider-admin-' + req.user.email)) {
    } else if (!conversationId.startsWith('customer-admin-') && !conversationId.startsWith('provider-admin-')) {
      const taskId = parseInt(conversationId, 10);
      if (isNaN(taskId)) return res.status(403).json({ error: 'Forbidden' });
      const task = await db2.prepare("SELECT * FROM tasks WHERE id = ? AND (provider_name = ? OR provider_name = ?)").get(taskId, prov.business_name, prov.firstname + ' ' + prov.lastname);
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
  await db.prepare('INSERT INTO chat_messages (conversation_id, sender, message, encrypted) VALUES (?, ?, ?, 1)')
    .run(conversationId, sanitize(s), encrypted);
  const adminEmail = await db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_email'").pluck().get();
  const convTaskId = parseInt(conversationId, 10);
  if (!isNaN(convTaskId)) {
    const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(convTaskId);
    if (task) {
      if (sender === 'Customer' || s === 'Customer') {
        const prov = await db.prepare("SELECT email FROM providers WHERE business_name = ? OR (firstname || ' ' || lastname) = ?").get(task.provider_name, task.provider_name);
        if (prov) {
          await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
            .run(prov.email, '💬', 'New Message from Customer', task.customer_email + ' sent a message about ' + (task.service_name || 'your order'), 'chat');
        }
      } else {
        await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
          .run(task.customer_email, '💬', 'New Message from Provider', 'Your provider sent a message about ' + (task.service_name || 'your order'), 'chat');
      }
    }
  } else if (conversationId.startsWith('customer-admin-')) {
    if (adminEmail) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(adminEmail, '💬', 'New Customer Message', (req.user.email || 'Customer') + ' sent a message', 'chat');
    }
  } else if (conversationId.startsWith('provider-admin-')) {
    if (adminEmail) {
      await db.prepare("INSERT INTO notifications (user_email, icon, title, message, type) VALUES (?, ?, ?, ?, ?)")
        .run(adminEmail, '💬', 'New Provider Message', (req.user.email || 'Provider') + ' sent a message', 'chat');
    }
  }
  res.json({ success: true });
});

router.get('/conversations/mine', async (req, res) => {
  const db = getDb();
  const userEmail = req.user.email;
  const convs = await db.prepare("SELECT DISTINCT conversation_id FROM chat_messages WHERE conversation_id LIKE ? ORDER BY created_at DESC")
    .all(`customer-admin-${userEmail}%`);
  return res.json(convs.map(c => c.conversation_id));
});

router.delete('/:conversationId/message/:messageId', async (req, res) => {
  const convId = req.params.conversationId;
  const db = getDb();
  if (req.user.role === 'customer') {
    if (!convId.startsWith('customer-admin-' + req.user.email)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else if (req.user.role === 'provider') {
    const prov = await db.prepare('SELECT * FROM providers WHERE email = ?').get(req.user.email);
    if (!prov) return res.status(403).json({ error: 'Forbidden' });
    if (convId.startsWith('provider-admin-' + req.user.email)) {
    } else if (!convId.startsWith('customer-admin-') && !convId.startsWith('provider-admin-')) {
      const taskId = parseInt(convId, 10);
      if (isNaN(taskId)) return res.status(403).json({ error: 'Forbidden' });
      const task = await db.prepare("SELECT * FROM tasks WHERE id = ? AND (provider_name = ? OR provider_name = ?)").get(taskId, prov.business_name, prov.firstname + ' ' + prov.lastname);
      if (!task) return res.status(403).json({ error: 'Forbidden' });
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const msg = await db.prepare('SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?').get(req.params.messageId, convId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  await db.prepare('DELETE FROM chat_messages WHERE id = ?').run(req.params.messageId);
  res.json({ success: true });
});

module.exports = router;
