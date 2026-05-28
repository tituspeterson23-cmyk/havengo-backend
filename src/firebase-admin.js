const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');

let firebaseApp = null;

function initFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;
  if (!fs.existsSync(serviceAccountPath)) {
    console.warn('WARNING: service-account.json not found. Firebase chat will not work.');
    console.warn('Place your Firebase service account key at: ' + serviceAccountPath);
    return null;
  }
  const serviceAccount = require(serviceAccountPath);
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin initialized');
  return firebaseApp;
}

function getFirebaseAuth() {
  if (!firebaseApp) return null;
  return admin.auth();
}

module.exports = { initFirebaseAdmin, getFirebaseAuth };
