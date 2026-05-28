const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const https = require('https');

const sa = JSON.parse(fs.readFileSync('C:\\Users\\Peterson\\Desktop\\havengo-backend\\service-account.json', 'utf8'));
const projectId = sa.project_id;

function getAccessToken() {
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };
    const signed = jwt.sign(payload, sa.private_key, { algorithm: 'RS256' });

    const data = 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(signed);
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).access_token);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function enableEmailPassword(accessToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      signIn: {
        email: { enabled: true, passwordRequired: true }
      }
    });
    const req = https.request({
      hostname: 'identitytoolkit.googleapis.com',
      path: '/admin/v2/projects/' + projectId + '/config?updateMask=signIn',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('Enable Email/Password response status:', res.statusCode);
        console.log('Response:', data.substring(0, 500));
        resolve({ status: res.statusCode, data: data });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function deployFirestoreRules(accessToken) {
  return new Promise((resolve, reject) => {
    const rulesContent = fs.readFileSync('C:\\Users\\Peterson\\Desktop\\havengo-backend\\firestore.rules', 'utf8');

    const rulesetBody = JSON.stringify({
      source: { files: [{ name: 'firestore.rules', content: rulesContent }] }
    });

    const req1 = https.request({
      hostname: 'firebaserules.googleapis.com',
      path: '/v1/projects/' + projectId + '/rulesets',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('Upload ruleset status:', res.statusCode);
        if (res.statusCode >= 400) {
          console.log('Error:', data);
          resolve({ status: res.statusCode, error: data });
          return;
        }
        const ruleset = JSON.parse(data);
        console.log('Ruleset name:', ruleset.name);

        const getReq = https.request({
          hostname: 'firebaserules.googleapis.com',
          path: '/v1/projects/' + projectId + '/releases/cloud.firestore',
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + accessToken }
        }, (getRes) => {
          let getData = '';
          getRes.on('data', c => getData += c);
          getRes.on('end', () => {
            const existingRelease = getRes.statusCode === 200 ? JSON.parse(getData) : null;
            const releaseName = existingRelease ? existingRelease.name : 'projects/' + projectId + '/releases/cloud.firestore';

            const releaseBody = JSON.stringify({
              name: releaseName,
              rulesetName: ruleset.name
            });

            const method = existingRelease ? 'PATCH' : 'POST';
            const req2 = https.request({
              hostname: 'firebaserules.googleapis.com',
              path: '/' + releaseName,
              method: method,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + accessToken
              }
            }, (relRes) => {
              let relData = '';
              relRes.on('data', c => relData += c);
              relRes.on('end', () => {
                console.log('Release status:', relRes.statusCode);
                console.log('Release response:', relData.substring(0, 500));
                resolve({ status: relRes.statusCode, data: relData });
              });
            });
            req2.on('error', reject);
            req2.write(releaseBody);
            req2.end();
          });
        });
        getReq.on('error', reject);
        getReq.end();
      });
    });
    req1.on('error', reject);
    req1.write(rulesetBody);
    req1.end();
  });
}

(async () => {
  try {
    console.log('Getting access token...');
    const token = await getAccessToken();
    console.log('Got access token (first 50):', token.substring(0, 50) + '...');

    console.log('\n=== Step 1: Enable Email/Password Auth ===');
    const authResult = await enableEmailPassword(token);
    console.log('Done.');

    console.log('\n=== Step 2: Deploy Firestore Rules ===');
    const rulesResult = await deployFirestoreRules(token);
    console.log('Done.');

    console.log('\n=== Summary ===');
    var authOk = authResult.status === 200;
    var rulesOk = rulesResult.status < 300;
    console.log('Email/Password auth:', authOk ? 'ENABLED' : 'Status ' + authResult.status);
    console.log('Firestore rules:', rulesOk ? 'DEPLOYED' : 'Status ' + rulesResult.status);
    console.log('Both OK?', authOk && rulesOk ? 'YES - Firebase chat should work' : 'NO - check errors above');
  } catch(e) {
    console.error('Error:', e.message, e.stack);
  }
})();
