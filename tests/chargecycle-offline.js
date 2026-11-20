/* ChargeCycle offline verification (headless Firefox via playwright-core).
   Follows ChatGPT's 8-step offline test exactly:
   1. load online, wait for the service worker to control the page
   2. switch browser offline
   3. reload
   4. create a device
   5. record a completed battery usage session
   6. verify dashboard calculations update
   7. reload while still offline, confirm records persist
   8. confirm zero uncaught errors
   Usage: node tests/chargecycle-offline.js */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = '/home/hatch/workspace/daily-projects/2026-11-20-chargecycle';
const PORT = 8145;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const file = path.join(PROJECT, urlPath);
      if (!file.startsWith(PROJECT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function dbState(page) {
  return await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('chargecycle', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['devices', 'sessions'], 'readonly');
      const out = {};
      let done = 0;
      for (const name of ['devices', 'sessions']) {
        const r = tx.objectStore(name).getAll();
        r.onsuccess = () => { out[name] = r.result; if (++done === 2) { db.close(); resolve(out); } };
        r.onerror = () => reject(r.error);
      }
    };
    req.onerror = () => reject(req.error);
  }));
}

async function dt(page, offsetMs) {
  return await page.evaluate((off) => {
    const d = new Date(Date.now() + off);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }, offsetMs);
}

async function statValue(page, label) {
  return await page.evaluate((lbl) => {
    const cards = Array.from(document.querySelectorAll('.stat-card'));
    const card = cards.find(c => c.querySelector('.stat-label') && c.querySelector('.stat-label').textContent.trim() === lbl);
    return card ? card.querySelector('.stat-value').textContent.trim() : null;
  }, label);
}

(async () => {
  const server = await serve();
  const browser = await firefox.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('requestfailed', r => failedRequests.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));

  // Step 1: load online, wait for the service worker to control the page
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(1000);
  await page.reload({ waitUntil: 'load' });
  await sleep(1000);
  let controlled = false;
  for (let i = 0; i < 10 && !controlled; i++) {
    controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (!controlled) await sleep(500);
  }
  check('step 1: service worker controls the page', controlled);
  const cacheKeys = await page.evaluate(() => caches.keys());
  check('step 1: chargecycle-v1 cache present', cacheKeys.includes('chargecycle-v1'));

  // Step 2: switch browser offline
  await context.setOffline(true);
  check('step 2: browser switched offline', true);

  // Step 3: reload offline
  let reloadedOffline = false;
  try {
    await page.reload({ waitUntil: 'load', timeout: 15000 });
    reloadedOffline = true;
  } catch (e) { reloadedOffline = false; }
  check('step 3: page reloads while offline', reloadedOffline);
  if (reloadedOffline) {
    check('step 3: dashboard visible offline', (await page.evaluate(() => document.body.innerText)).includes('Dashboard'));
    check('step 3: app title present offline', (await page.title()).includes('ChargeCycle'));
  }

  // Step 4: create a device while offline
  await page.click('[data-view="devices"]');
  await page.click('#addDeviceBtn');
  await page.fill('#deviceName', 'Offline Phone');
  await page.selectOption('#deviceCategory', 'Phone');
  await page.click('#deviceForm button[type="submit"]');
  await sleep(500);
  let db = await dbState(page);
  check('step 4: device created while offline', db.devices.length === 1 && db.devices[0].name === 'Offline Phone');

  // Step 5: record a completed battery usage session while offline
  await page.click('[data-view="tracker"]');
  await page.selectOption('#manualDevice', { index: 0 });
  await page.selectOption('#manualType', 'usage');
  await page.fill('#manualStartPct', '80');
  await page.fill('#manualEndPct', '60');
  await page.fill('#manualStartTime', await dt(page, -3 * 3600000));
  await page.fill('#manualEndTime', await dt(page, -1 * 3600000));
  await page.click('#manualForm button[type="submit"]');
  await sleep(500);
  db = await dbState(page);
  check('step 5: usage session recorded while offline', db.sessions.length === 1 && db.sessions[0].status === 'completed');

  // Step 6: dashboard calculations update while offline
  await page.click('[data-view="dashboard"]');
  await sleep(400);
  check('step 6: dashboard completed sessions = 1', (await statValue(page, 'Completed sessions')) === '1');
  check('step 6: dashboard avg estimated runtime = 10 h', (await statValue(page, 'Avg. estimated battery life')) === '10 h');
  check('step 6: figures shown offline', (await page.evaluate(() => document.body.innerText)).includes('Used 20% in 2 h'));

  // Step 7: reload while still offline, records persist
  await page.reload({ waitUntil: 'load', timeout: 15000 });
  await sleep(800);
  db = await dbState(page);
  check('step 7: device persists after offline reload', db.devices.length === 1 && db.devices[0].name === 'Offline Phone');
  check('step 7: session persists after offline reload', db.sessions.length === 1 && db.sessions[0].startPct === 80 && db.sessions[0].endPct === 60);
  await page.click('[data-view="dashboard"]');
  await sleep(400);
  check('step 7: dashboard still shows 1 completed session', (await statValue(page, 'Completed sessions')) === '1');

  // Step 8: zero uncaught errors
  check('step 8: zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('step 8: zero page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('step 8: zero failed requests', failedRequests.length === 0, failedRequests.join(' | '));

  await browser.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR', e); process.exit(2); });
