const admin = require('firebase-admin');
const { getFirestoreDb } = require('./firebase-admin');

// Write a task event to Firestore for real-time frontend updates
async function emitTaskEvent(taskId, action, data) {
  try {
    const db = getFirestoreDb();
    if (!db) return;
    await db.collection('task_events').add({
      taskId: Number(taskId),
      action: action,
      customerEmail: data.customerEmail || '',
      providerEmail: data.providerEmail || '',
      status: data.status || '',
      serviceName: data.serviceName || '',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) {
    console.warn('Firestore event error:', e.message);
  }
}

// Write a notification to Firestore for real-time frontend updates
async function emitNotification(recipientEmail, icon, title, message, type) {
  try {
    const db = getFirestoreDb();
    if (!db) return;
    await db.collection('notifications_realtime').add({
      recipientEmail: recipientEmail,
      icon: icon || '',
      title: title || '',
      message: message || '',
      type: type || 'general',
      read: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) {
    console.warn('Firestore notification error:', e.message);
  }
}

module.exports = { emitTaskEvent, emitNotification };
