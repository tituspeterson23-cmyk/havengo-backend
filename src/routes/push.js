const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const { authenticate } = require('../middleware/authenticate');

function getDb() {
  return require('../database').getDb();
}

// Get or generate VAPID keys
async function ensureVapidKeys() {
  const db = getDb();
  let publicKey = await db.prepare("SELECT value FROM admin_settings WHERE key = 'vapid_public_key'").pluck().get();
  if (!publicKey) {
    const vapidKeys = webpush.generateVAPIDKeys();
    publicKey = vapidKeys.publicKey;
    const privateKey = vapidKeys.privateKey;
    await db.prepare("INSERT INTO admin_settings (key, value) VALUES ('vapid_public_key', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(publicKey);
    await db.prepare("INSERT INTO admin_settings (key, value) VALUES ('vapid_private_key', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(privateKey);
    console.log('VAPID keys generated and stored.');
  }
  return publicKey;
}

// Get VAPID keys for sending push
async function getVapidKeys() {
  const db = getDb();
  const publicKey = await db.prepare("SELECT value FROM admin_settings WHERE key = 'vapid_public_key'").pluck().get();
  const privateKey = await db.prepare("SELECT value FROM admin_settings WHERE key = 'vapid_private_key'").pluck().get();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

router.get('/vapid-public-key', async (req, res) => {
  try {
    const key = await ensureVapidKeys();
    res.json({ publicKey: key });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get VAPID key' });
  }
});

router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }
    const db = getDb();
    await db.prepare("DELETE FROM push_subscriptions WHERE user_email = ? AND endpoint = ?").run(req.user.email, subscription.endpoint);
    await db.prepare("INSERT INTO push_subscriptions (user_email, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)")
      .run(req.user.email, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
    res.json({ success: true });
  } catch (e) {
    console.warn('Push subscribe error:', e);
    res.status(500).json({ error: 'Subscription failed' });
  }
});

router.post('/unsubscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;
    const db = getDb();
    if (endpoint) {
      await db.prepare("DELETE FROM push_subscriptions WHERE user_email = ? AND endpoint = ?").run(req.user.email, endpoint);
    } else {
      await db.prepare("DELETE FROM push_subscriptions WHERE user_email = ?").run(req.user.email);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Unsubscribe failed' });
  }
});

// Send push notification to a specific user (called from other modules)
async function sendPushNotification(userEmail, title, body, data = {}) {
  try {
    const db = getDb();
    const keys = await getVapidKeys();
    if (!keys) return;

    webpush.setVapidDetails(
      'mailto:thermypetson@gmail.com',
      keys.publicKey,
      keys.privateKey
    );

    const subs = await db.prepare("SELECT * FROM push_subscriptions WHERE user_email = ?").all(userEmail);
    const payload = JSON.stringify({ title, body, icon: '/favicon.ico', badge: '/favicon.ico', data, tag: 'havengo-notification' });

    for (const sub of subs) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
        }
      }
    }
  } catch (e) {
    console.warn('Push notification error for', userEmail, e.message);
  }
}

module.exports = router;
module.exports.sendPushNotification = sendPushNotification;
module.exports.ensureVapidKeys = ensureVapidKeys;
