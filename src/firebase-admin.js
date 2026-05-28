const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');

function loadServiceAccount() {
  // 1. Try local file (development)
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Firebase: loading service-account.json from file');
    return require(serviceAccountPath);
  }
  // 2. Try base64 env var (Render — set FIREBASE_SERVICE_ACCOUNT_BASE64)
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    console.log('Firebase: loading service account from FIREBASE_SERVICE_ACCOUNT_BASE64');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  }
  // 3. Try raw JSON env var
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    console.log('Firebase: loading service account from FIREBASE_SERVICE_ACCOUNT env var');
    return JSON.parse(raw);
  }
  return null;
}

let firebaseApp = null;

function initFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    console.warn('WARNING: service-account.json not found and no FIREBASE_SERVICE_ACCOUNT[_BASE64] env var set. Firebase chat will not work.');
    console.warn('Place your Firebase service account key at: ' + serviceAccountPath);
    return null;
  }
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin initialized for project:', serviceAccount.project_id);
  return firebaseApp;
}

function getFirebaseAuth() {
  if (!firebaseApp) return null;
  return admin.auth();
}

module.exports = { initFirebaseAdmin, getFirebaseAuth };
