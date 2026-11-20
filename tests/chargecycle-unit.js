/* ChargeCycle Node unit checks for calculations.js.
   Usage: node tests/chargecycle-unit.js */
const c = require('../calculations.js');
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
function eq(a, b) { return Math.abs(a - b) < 1e-9; }

// durations and rates
check('duration 2h', eq(c.durationMinutes('2026-11-20T08:00:00Z', '2026-11-20T10:00:00Z'), 120));
check('formatDuration 135m', c.formatDuration(135) === '2 h 15 min');
check('formatDuration 45m', c.formatDuration(45) === '45 min');
check('formatDuration 60m', c.formatDuration(60) === '1 h');
check('formatHours 12.5', c.formatHours(12.5) === '12.5 h');
check('formatHours null', c.formatHours(null) === '—');
check('usage delta 80->60', c.pctDelta('usage', 80, 60) === 20);
check('charging delta 20->80', c.pctDelta('charging', 20, 80) === 60);
check('rate 20% in 2h', eq(c.ratePerHour(20, 120), 10));
check('rate zero change', c.ratePerHour(0, 120) === 0);
check('rate zero duration null', c.ratePerHour(20, 0) === null);
check('runtime 10%/h -> 10h', eq(c.estimatedRuntimeHours(10), 10));
check('runtime 0%/h null', c.estimatedRuntimeHours(0) === null);
check('runtime null', c.estimatedRuntimeHours(null) === null);

// device stats: 2 usage sessions (20% in 2h, 10% in 1h) + 1 charging (40% in 1h)
const sessions = [
  { type: 'usage', status: 'completed', startPct: 80, endPct: 60, startTime: '2026-11-20T08:00:00Z', endTime: '2026-11-20T10:00:00Z' },
  { type: 'usage', status: 'completed', startPct: 60, endPct: 50, startTime: '2026-11-20T09:00:00Z', endTime: '2026-11-20T10:00:00Z' },
  { type: 'charging', status: 'completed', startPct: 20, endPct: 60, startTime: '2026-11-20T11:00:00Z', endTime: '2026-11-20T12:00:00Z' },
  { type: 'usage', status: 'live', startPct: 90, endPct: null, startTime: '2026-11-20T13:00:00Z', endTime: null }
];
const st = c.deviceStats(sessions);
check('stats total completed 3', st.totalSessions === 3);
check('stats usage 2', st.usageSessions === 2);
check('stats charging 1', st.chargingSessions === 1);
check('stats avg consumption 10%/h', eq(st.avgConsumptionPerHour, 10), JSON.stringify(st));
check('stats avg charge 40%/h', eq(st.avgChargeRatePerHour, 40));
check('stats runtime 10h', eq(st.estimatedRuntimeHours, 10));

// zero-change usage session: stats stay safe
const stZero = c.deviceStats([{ type: 'usage', status: 'completed', startPct: 50, endPct: 50, startTime: '2026-11-20T08:00:00Z', endTime: '2026-11-20T10:00:00Z' }]);
check('zero-change avg 0', stZero.avgConsumptionPerHour === 0);
check('zero-change runtime null', stZero.estimatedRuntimeHours === null);

// device validation
check('device ok', c.validateDevice({ name: 'iPhone', category: 'Phone' }).length === 0);
check('device name too short', c.validateDevice({ name: 'x', category: 'Phone' }).length === 1);
check('device bad category', c.validateDevice({ name: 'iPhone', category: 'Watch' }).length === 1);
check('device capacity 50 rejected', c.validateDevice({ name: 'iPhone', category: 'Phone', capacityMah: 50 }).length === 1);
check('device capacity 4685 ok', c.validateDevice({ name: 'iPhone', category: 'Phone', capacityMah: 4685 }).length === 0);

// session validation (now pinned to 2026-11-20T12:00Z)
const NOW = Date.parse('2026-11-20T12:00:00Z');
const good = { deviceId: 'd1', type: 'usage', startPct: 80, endPct: 60, startTime: '2026-11-20T08:00:00Z', endTime: '2026-11-20T10:00:00Z' };
check('session ok', c.validateSession(good, NOW).length === 0);
check('session pct 101 rejected', c.validateSession(Object.assign({}, good, { endPct: 101 }), NOW).length > 0);
check('session pct -1 rejected', c.validateSession(Object.assign({}, good, { startPct: -1 }), NOW).length > 0);
check('usage gaining rejected', c.validateSession(Object.assign({}, good, { endPct: 90 }), NOW).length > 0);
check('charging losing rejected', c.validateSession(Object.assign({}, good, { type: 'charging', startPct: 20, endPct: 10 }), NOW).length > 0);
check('end before start rejected', c.validateSession(Object.assign({}, good, { endTime: '2026-11-20T07:00:00Z' }), NOW).length > 0);
check('future end rejected', c.validateSession(Object.assign({}, good, { endTime: '2026-11-20T13:00:00Z' }), NOW).length > 0);
check('zero-change session accepted', c.validateSession(Object.assign({}, good, { endPct: 80 }), NOW).length === 0);
check('live start ok', c.validateLiveStart({ deviceId: 'd1', type: 'charging', startPct: 20, startTime: '2026-11-20T11:00:00Z' }, NOW).length === 0);
check('live start future rejected', c.validateLiveStart({ deviceId: 'd1', type: 'charging', startPct: 20, startTime: '2026-11-20T13:00:00Z' }, NOW).length > 0);
const live = { deviceId: 'd1', type: 'usage', startPct: 80, startTime: '2026-11-20T08:00:00Z' };
check('live stop ok', c.validateLiveStop(live, 60, '2026-11-20T10:00:00Z', NOW).length === 0);
check('live stop gaining rejected', c.validateLiveStop(live, 90, '2026-11-20T10:00:00Z', NOW).length > 0);
check('live stop before start rejected', c.validateLiveStop(live, 60, '2026-11-20T07:00:00Z', NOW).length > 0);

// CSV
const csv = c.buildCsv(
  [{ id: 'd1', name: 'Phone' }],
  [{ id: 's1', deviceId: 'd1', type: 'usage', startPct: 80, endPct: 60, startTime: '2026-11-20T08:00:00Z', endTime: '2026-11-20T10:00:00Z', status: 'completed', notes: '=2+2' }]
);
check('csv has header + row', csv.split('\r\n').length === 3, csv);
check('csv neutralises formula note', csv.indexOf("'=2+2") !== -1, csv);
check('csv rate 10', csv.indexOf(',10,') !== -1 || csv.indexOf(',10\r') !== -1, csv);

// backup
const backup = c.buildBackup([{ id: 'd1', name: 'Phone', category: 'Phone' }], [Object.assign({ id: 's1', status: 'completed' }, good)]);
check('backup schema 1', backup.schema === 1);
check('backup validates', c.validateBackup(backup).length === 0, JSON.stringify(c.validateBackup(backup)));
check('backup bad schema rejected', c.validateBackup({ schema: 99, app: 'chargecycle', devices: [], sessions: [] }).length > 0);
check('backup orphan session rejected', c.validateBackup({ schema: 1, app: 'chargecycle', devices: [], sessions: [Object.assign({ id: 's1' }, good)] }).length > 0);
check('backup wrong app rejected', c.validateBackup({ schema: 1, app: 'other', devices: [], sessions: [] }).length > 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail ? 1 : 0);
