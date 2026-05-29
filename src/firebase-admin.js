const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');

function loadServiceAccount() {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Firebase: loading service-account.json from file');
    return require(serviceAccountPath);
  }
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    console.log('Firebase: loading service account from FIREBASE_SERVICE_ACCOUNT_BASE64');
    const decoded = Buffer.from(b64.trim(), 'base64').toString('utf-8');
    console.log('Firebase: decoded length:', decoded.length, 'chars, first 50:', JSON.stringify(decoded.substring(0, 50)));
    return JSON.parse(decoded);
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    console.log('Firebase: loading service account from FIREBASE_SERVICE_ACCOUNT env var');
    return JSON.parse(raw);
  }
  return null;
}

let firebaseApp = null;
let firestoreDb = null;

function initFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    console.warn('WARNING: service-account.json not found and no FIREBASE_SERVICE_ACCOUNT[_BASE64] env var set. Firebase features disabled.');
    return null;
  }
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  firestoreDb = admin.firestore();
  firestoreDb.settings({ timestampsInSnapshots: true });
  console.log('Firebase Admin initialized for project:', serviceAccount.project_id);
  return firebaseApp;
}

function getFirebaseAuth() {
  if (!firebaseApp) return null;
  return admin.auth();
}

function getFirestoreDb() {
  if (!firebaseApp) initFirebaseAdmin();
  return firestoreDb;
}

module.exports = { initFirebaseAdmin, getFirebaseAuth, getFirestoreDb };
