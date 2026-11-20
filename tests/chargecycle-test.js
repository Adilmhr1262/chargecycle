/* ChargeCycle verification suite (headless Firefox via playwright-core).
   Serves the project over local HTTP, then runs the order's acceptance
   checklist plus validation and edge cases. Usage: node tests/chargecycle-test.js */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = '/home/hatch/workspace/daily-projects/2026-11-20-chargecycle';
const PORT = 8144;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; failures.push(name); console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
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

/* datetime-local value for now + offsetMs, computed in the page (browser TZ). */
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

async function bodyText(page) { return await page.evaluate(() => document.body.innerText); }

(async () => {
  const server = await serve();
  const browser = await firefox.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const external = [];
  const consoleErrors = [];
  const pageErrors = [];
  let dialogSeen = false;
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:' + PORT)) external.push(r.url()); });
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('dialog', () => { dialogSeen = true; });

  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(800);

  // 1. First launch: zero records, meaningful empty states
  let db = await dbState(page);
  check('first launch zero devices', db.devices.length === 0);
  check('first launch zero sessions', db.sessions.length === 0);
  check('dashboard devices stat 0', (await statValue(page, 'Total devices')) === '0');
  check('dashboard completed stat 0', (await statValue(page, 'Completed sessions')) === '0');
  check('empty state text present', (await bodyText(page)).includes('Nothing recorded yet.'));

  // 2. Add two devices
  await page.click('[data-view="devices"]');
  await page.click('#addDeviceBtn');
  await page.fill('#deviceName', 'Pixel 8 Pro');
  await page.fill('#deviceBrand', 'Google');
  await page.fill('#deviceModel', 'GC3VE');
  await page.fill('#deviceCapacity', '5050');
  await page.click('#deviceForm button[type="submit"]');
  await sleep(400);
  db = await dbState(page);
  check('device 1 saved', db.devices.length === 1 && db.devices[0].name === 'Pixel 8 Pro' && db.devices[0].capacityMah === 5050);
  check('device card shows name', (await bodyText(page)).includes('Pixel 8 Pro'));
  await page.click('#addDeviceBtn');
  await page.fill('#deviceName', 'MacBook Air');
  await page.fill('#deviceBrand', 'Apple');
  await page.selectOption('#deviceCategory', 'Laptop');
  await page.click('#deviceForm button[type="submit"]');
  await sleep(400);
  db = await dbState(page);
  check('device 2 saved', db.devices.length === 2);

  // device name validation: 1 char rejected
  await page.click('#addDeviceBtn');
  await page.fill('#deviceName', 'x');
  await page.click('#deviceForm button[type="submit"]');
  await sleep(300);
  check('1-char device name rejected', await page.isVisible('#deviceError'));
  db = await dbState(page);
  check('no device added after rejection', db.devices.length === 2);
  await page.click('#deviceDialog [data-close]');

  // XSS: markup in device name renders as text
  await page.click('#addDeviceBtn');
  await page.fill('#deviceName', '<img src=x onerror=alert(1)>');
  await page.click('#deviceForm button[type="submit"]');
  await sleep(400);
  db = await dbState(page);
  check('markup device name saved as text', db.devices.length === 3);
  check('no injected img element', (await page.evaluate(() => document.querySelectorAll('#deviceGrid img').length)) === 0);
  check('no alert dialog fired', dialogSeen === false);
  // remove the markup device to keep later counts clean
  const markupId = db.devices.find(d => d.name.includes('img')).id;
  await page.click('[data-delete-device="' + markupId + '"]');
  await sleep(300);
  await page.click('#confirmYes');
  await sleep(400);
  db = await dbState(page);
  check('markup device deleted', db.devices.length === 2);

  // 3. Manual usage session: 80 -> 60 over 2h = 10%/h, est runtime 10h
  await page.click('[data-view="tracker"]');
  const tMinus3h = await dt(page, -3 * 3600000);
  const tMinus1h = await dt(page, -1 * 3600000);
  const tMinus2h = await dt(page, -2 * 3600000);
  await page.selectOption('#manualDevice', { index: 0 });
  await page.selectOption('#manualType', 'usage');
  await page.fill('#manualStartPct', '80');
  await page.fill('#manualEndPct', '60');
  await page.fill('#manualStartTime', tMinus3h);
  await page.fill('#manualEndTime', tMinus1h);
  await page.click('#manualForm button[type="submit"]');
  await sleep(400);
  db = await dbState(page);
  check('usage session saved', db.sessions.length === 1 && db.sessions[0].status === 'completed');
  await page.click('[data-view="dashboard"]');
  await sleep(300);
  check('usage figures shown', (await bodyText(page)).includes('Used 20% in 2 h'));
  check('dashboard completed 1', (await statValue(page, 'Completed sessions')) === '1');
  check('dashboard avg est runtime 10 h', (await statValue(page, 'Avg. estimated battery life')) === '10 h');
  check('estimate labelled Estimated', (await bodyText(page)).includes('Estimated 10 h'));
  check('estimate disclaimer present', (await bodyText(page)).includes('not a guarantee of battery health'));

  // 4. Manual charging session: 20 -> 80 over 1h = 60%/h
  await page.click('[data-view="tracker"]');
  await page.selectOption('#manualDevice', { index: 1 });
  await page.selectOption('#manualType', 'charging');
  await page.fill('#manualStartPct', '20');
  await page.fill('#manualEndPct', '80');
  await page.fill('#manualStartTime', tMinus2h);
  await page.fill('#manualEndTime', tMinus1h);
  await page.click('#manualForm button[type="submit"]');
  await sleep(400);
  db = await dbState(page);
  check('charging session saved', db.sessions.length === 2);
  await page.click('[data-view="dashboard"]');
  await sleep(300);
  check('charging figures shown', (await bodyText(page)).includes('Gained 60% in 1 h'));
  await page.click('[data-view="devices"]');
  await sleep(300);
  check('device card avg charge 60%/h', (await bodyText(page)).includes('60%/h'));

  // 5. Validation rejections (no new sessions)
  await page.click('[data-view="tracker"]');
  async function tryManual(startPct, endPct, type, startT, endT) {
    await page.selectOption('#manualDevice', { index: 0 });
    await page.selectOption('#manualType', type);
    await page.fill('#manualStartPct', String(startPct));
    await page.fill('#manualEndPct', String(endPct));
    await page.fill('#manualStartTime', startT);
    await page.fill('#manualEndTime', endT);
    await page.click('#manualForm button[type="submit"]');
    await sleep(300);
  }
  await tryManual(80, 90, 'usage', tMinus3h, tMinus1h);
  check('usage gaining rejected', await page.isVisible('#manualError'));
  await tryManual(20, 10, 'charging', tMinus3h, tMinus1h);
  check('charging losing rejected', await page.isVisible('#manualError'));
  await tryManual(80, 60, 'usage', tMinus1h, tMinus3h);
  check('end before start rejected', await page.isVisible('#manualError'));
  await tryManual(80, 101, 'usage', tMinus3h, tMinus1h);
  check('pct 101 rejected', await page.isVisible('#manualError'));
  const tFuture = await dt(page, 2 * 3600000);
  await tryManual(80, 60, 'usage', tMinus3h, tFuture);
  check('future end rejected', await page.isVisible('#manualError'));
  db = await dbState(page);
  check('no sessions added by rejections', db.sessions.length === 2);

  // 6. Zero-change session accepted safely
  await tryManual(50, 50, 'usage', tMinus3h, tMinus1h);
  await sleep(300);
  db = await dbState(page);
  check('zero-change session saved', db.sessions.length === 3);
  await page.click('[data-view="dashboard"]');
  await sleep(300);
  check('zero-change figures safe', (await bodyText(page)).includes('Used 0% in 2 h'));

  // 7. Live session: start, survives reload, stop
  await page.click('[data-view="tracker"]');
  await sleep(300);
  await page.selectOption('#liveDevice', { index: 0 });
  await page.selectOption('#liveType', 'usage');
  await page.fill('#liveStartPct', '55');
  const tNow = await dt(page, 0);
  await page.fill('#liveStartTime', tNow);
  await page.click('#liveForm button[type="submit"]');
  await sleep(500);
  db = await dbState(page);
  check('live session saved', db.sessions.filter(s => s.status === 'live').length === 1);
  check('live badge shown', (await bodyText(page)).includes('Live'));
  await page.reload({ waitUntil: 'load' });
  await sleep(800);
  db = await dbState(page);
  check('live session survives reload', db.sessions.filter(s => s.status === 'live').length === 1);
  await page.click('[data-view="tracker"]');
  await sleep(300);
  check('live card after reload', (await bodyText(page)).includes('Live'));
  check('elapsed ticking', (await bodyText(page)).includes('elapsed'));
  await page.click('#liveList [data-stop]');
  await sleep(300);
  await page.fill('#stopEndPct', '50');
  // stop a minute after the start minute: end must be after start at minute precision
  await page.fill('#stopEndTime', await dt(page, 60000));
  await page.click('#stopForm button[type="submit"]');
  await sleep(400);
  db = await dbState(page);
  check('live session stopped and completed', db.sessions.filter(s => s.status === 'completed').length === 4 && db.sessions.filter(s => s.status === 'live').length === 0);
  await page.click('[data-view="dashboard"]');
  await sleep(300);
  check('dashboard completed 4 after stop', (await statValue(page, 'Completed sessions')) === '4');

  // 8. History filters + edit + delete
  await page.click('[data-view="history"]');
  await sleep(300);
  await page.selectOption('#filterDevice', { index: 2 }); // MacBook Air (index 0 = All)
  await sleep(300);
  let histText = await bodyText(page);
  check('filter by device MacBook', histText.includes('MacBook Air') && !histText.includes('Pixel 8 Pro'));
  await page.selectOption('#filterDevice', { index: 0 });
  await page.selectOption('#filterType', 'charging');
  await sleep(300);
  histText = await bodyText(page);
  check('filter by type charging', histText.includes('Charging') && !histText.includes('Used 20%'));
  await page.selectOption('#filterType', '');
  await page.fill('#filterSearch', 'pixel');
  await sleep(300);
  histText = await bodyText(page);
  check('search finds Pixel sessions', histText.includes('Pixel 8 Pro') && !histText.includes('MacBook Air'));
  await page.click('#clearFilters');
  await sleep(300);
  // edit first completed session (the usage one): change end 60 -> 55
  const usageId = (await dbState(page)).sessions.find(s => s.type === 'usage' && s.startPct === 80 && s.status === 'completed').id;
  await page.click('[data-edit-session="' + usageId + '"]');
  await sleep(300);
  await page.fill('#editEndPct', '55');
  await page.click('#editSessionForm button[type="submit"]');
  await sleep(400);
  db = await dbState(page);
  check('session edit saved', db.sessions.find(s => s.id === usageId).endPct === 55);
  check('edited figures shown', (await bodyText(page)).includes('Used 25% in 2 h'));
  // delete the zero-change session
  const zeroId = (await dbState(page)).sessions.find(s => s.startPct === 50 && s.endPct === 50).id;
  await page.click('[data-delete-session="' + zeroId + '"]');
  await sleep(300);
  await page.click('#confirmYes');
  await sleep(400);
  db = await dbState(page);
  check('session deleted', db.sessions.length === 3 && !db.sessions.find(s => s.id === zeroId));

  // 9. CSV export content
  const dlCsv = page.waitForEvent('download', { timeout: 10000 });
  await page.click('#exportCsvBtn');
  const csvFile = await dlCsv;
  const csvPath = '/tmp/chargecycle-test.csv';
  await csvFile.saveAs(csvPath);
  const csvText = fs.readFileSync(csvPath, 'utf8');
  check('csv header present', csvText.startsWith('Device,Type,Start battery (%)'));
  check('csv has Pixel usage row', csvText.includes('Pixel 8 Pro,usage,80,55'));
  check('csv has charging row', csvText.includes('MacBook Air,charging,20,80'));

  // 10. JSON backup export, invalid restore rejected, valid restore works
  const dlJson = page.waitForEvent('download', { timeout: 10000 });
  await page.click('#exportJsonBtn');
  const jsonFile = await dlJson;
  const jsonPath = '/tmp/chargecycle-backup.json';
  await jsonFile.saveAs(jsonPath);
  const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  check('backup schema 1', backup.schema === 1 && backup.app === 'chargecycle');
  check('backup has 2 devices 3 sessions', backup.devices.length === 2 && backup.sessions.length === 3);
  const badPath = '/tmp/chargecycle-bad.json';
  fs.writeFileSync(badPath, JSON.stringify({ schema: 99, app: 'chargecycle', devices: [], sessions: [] }));
  await page.setInputFiles('#importJsonInput', badPath);
  await sleep(500);
  check('invalid backup rejected with message', (await bodyText(page)).includes('Backup rejected'));
  db = await dbState(page);
  check('data unchanged after bad restore', db.devices.length === 2 && db.sessions.length === 3);
  await page.setInputFiles('#importJsonInput', jsonPath);
  await sleep(500);
  check('valid backup restored', (await bodyText(page)).includes('Backup restored'));
  db = await dbState(page);
  check('data intact after valid restore', db.devices.length === 2 && db.sessions.length === 3);

  // 11. Device delete cascades sessions, dashboard updates
  await page.click('[data-view="devices"]');
  const macId = (await dbState(page)).devices.find(d => d.name === 'MacBook Air').id;
  await page.click('[data-delete-device="' + macId + '"]');
  await sleep(300);
  check('delete confirm mentions sessions', (await bodyText(page)).includes('session'));
  await page.click('#confirmYes');
  await sleep(400);
  db = await dbState(page);
  check('device deleted', db.devices.length === 1);
  check('device sessions cascaded', db.sessions.filter(s => s.deviceId === macId).length === 0);
  await page.click('[data-view="dashboard"]');
  await sleep(300);
  check('dashboard devices 1 after delete', (await statValue(page, 'Total devices')) === '1');

  // 12. Dark mode persists after reload
  await page.click('#themeToggle');
  await sleep(300);
  check('dark theme applied', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
  await page.reload({ waitUntil: 'load' });
  await sleep(800);
  check('dark theme persists after reload', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
  await page.click('#themeToggle');
  await sleep(200);

  // 13. Service worker cache (offline support)
  const swKeys = await page.evaluate(() => caches.keys());
  check('service worker cache exists', swKeys.includes('chargecycle-v1'), JSON.stringify(swKeys));

  // 14. Responsive: no overflow, correct nav per width
  for (const w of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await sleep(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('no horizontal overflow at ' + w + 'px', overflow <= 0, 'overflow ' + overflow);
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await sleep(300);
  check('bottom nav visible at 375px', await page.isVisible('.bottom-nav'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(300);
  check('sidebar visible at 1440px', await page.isVisible('.sidebar'));

  // 15. Delete all requires DELETE, then empties
  await page.click('[data-view="history"]');
  await page.click('#deleteAllBtn');
  await sleep(300);
  check('delete-all button disabled until DELETE', await page.isDisabled('#deleteAllYes'));
  await page.fill('#deleteAllConfirm', 'DELETE');
  await sleep(200);
  check('delete-all button enabled after DELETE', await page.isEnabled('#deleteAllYes'));
  await page.click('#deleteAllYes');
  await sleep(500);
  db = await dbState(page);
  check('delete all empties devices', db.devices.length === 0);
  check('delete all empties sessions', db.sessions.length === 0);

  // 16. Cleanliness
  check('zero external requests', external.length === 0, external.join(', '));
  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('zero page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed.' + (failures.length ? ' Failed: ' + failures.join('; ') : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR', e); process.exit(2); });
