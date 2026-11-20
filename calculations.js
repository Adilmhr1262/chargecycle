/* ChargeCycle - pure calculation and validation helpers.
   No DOM, no IndexedDB, no imports: safe to unit-test in Node and in the browser. */
"use strict";

function isFiniteNumber(n) {
  return typeof n === "number" && isFinite(n);
}

/* ---------- percentages ---------- */
function validPct(v) {
  return isFiniteNumber(v) && v >= 0 && v <= 100;
}

/* ---------- time ---------- */
function durationMinutes(startISO, endISO) {
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  if (!isFinite(s) || !isFinite(e)) return null;
  return (e - s) / 60000;
}

function formatDuration(min) {
  if (min === null || min === undefined || !isFinite(min) || min < 0) return "—";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return m + " min";
  if (m === 0) return h + " h";
  return h + " h " + m + " min";
}

function formatHours(h) {
  if (h === null || h === undefined || !isFinite(h) || h <= 0) return "—";
  if (h < 1) return Math.round(h * 60) + " min";
  return (Math.round(h * 10) / 10) + " h";
}

/* ---------- session math ---------- */
/* Usage: battery consumed = start - end. Charging: gained = end - start. */
function pctDelta(type, startPct, endPct) {
  if (type === "usage") return startPct - endPct;
  return endPct - startPct;
}

/* Percent per hour. Returns 0 for zero-change sessions, null when duration is invalid. */
function ratePerHour(deltaPct, durationMin) {
  if (!isFiniteNumber(durationMin) || durationMin <= 0) return null;
  return deltaPct / (durationMin / 60);
}

/* Estimated full-battery runtime (hours) from an average consumption rate.
   Null when there is no usable consumption (zero-change or no usage data). */
function estimatedRuntimeHours(avgConsumptionPerHour) {
  if (!isFiniteNumber(avgConsumptionPerHour) || avgConsumptionPerHour <= 0) return null;
  return 100 / avgConsumptionPerHour;
}

/* Per-device stats from its completed sessions only. */
function deviceStats(sessions) {
  const completed = sessions.filter(function (s) { return s.status === "completed"; });
  const usage = completed.filter(function (s) { return s.type === "usage"; });
  const charging = completed.filter(function (s) { return s.type === "charging"; });

  let usageConsumed = 0, usageMinutes = 0, usageRates = 0;
  for (const s of usage) {
    const d = durationMinutes(s.startTime, s.endTime);
    if (d === null || d <= 0) continue;
    usageConsumed += pctDelta("usage", s.startPct, s.endPct);
    usageMinutes += d;
    usageRates++;
  }
  let chargingGained = 0, chargingMinutes = 0;
  for (const s of charging) {
    const d = durationMinutes(s.startTime, s.endTime);
    if (d === null || d <= 0) continue;
    chargingGained += pctDelta("charging", s.startPct, s.endPct);
    chargingMinutes += d;
  }

  const avgConsumption = usageMinutes > 0 ? usageConsumed / (usageMinutes / 60) : null;
  const avgChargeRate = chargingMinutes > 0 ? chargingGained / (chargingMinutes / 60) : null;
  return {
    totalSessions: completed.length,
    usageSessions: usage.length,
    chargingSessions: charging.length,
    avgConsumptionPerHour: avgConsumption,
    avgChargeRatePerHour: avgChargeRate,
    estimatedRuntimeHours: estimatedRuntimeHours(avgConsumption),
    usageSessionsWithData: usageRates
  };
}

/* ---------- validation ---------- */
function validateDevice(d) {
  const errors = [];
  if (!d || typeof d.name !== "string" || d.name.trim().length < 2 || d.name.trim().length > 100) {
    errors.push("Device name must be 2 to 100 characters.");
  }
  if (d.brand !== undefined && d.brand !== null && d.brand !== "" && (typeof d.brand !== "string" || d.brand.length > 100)) {
    errors.push("Brand must be at most 100 characters.");
  }
  if (d.model !== undefined && d.model !== null && d.model !== "" && (typeof d.model !== "string" || d.model.length > 100)) {
    errors.push("Model must be at most 100 characters.");
  }
  const cats = ["Phone", "Laptop", "Tablet", "Earbuds", "Smartwatch", "Other"];
  if (!cats.includes(d.category)) errors.push("Choose a device category.");
  if (d.capacityMah !== undefined && d.capacityMah !== null && d.capacityMah !== "") {
    const c = Number(d.capacityMah);
    if (!Number.isInteger(c) || c < 100 || c > 100000) {
      errors.push("Battery capacity must be a whole number between 100 and 100000 mAh.");
    }
  }
  if (d.notes !== undefined && d.notes !== null && d.notes !== "" && (typeof d.notes !== "string" || d.notes.length > 500)) {
    errors.push("Notes must be at most 500 characters.");
  }
  return errors;
}

/* Validate a completed (manual) session. nowMs lets tests pin "now". */
function validateSession(s, nowMs) {
  const errors = [];
  const now = nowMs === undefined ? Date.now() : nowMs;
  if (!s || typeof s.deviceId !== "string" || !s.deviceId) errors.push("Choose a device.");
  if (s.type !== "usage" && s.type !== "charging") errors.push("Choose a session type.");
  if (!validPct(s.startPct)) errors.push("Starting battery must be between 0 and 100.");
  if (!validPct(s.endPct)) errors.push("Ending battery must be between 0 and 100.");
  const start = new Date(s.startTime).getTime();
  const end = new Date(s.endTime).getTime();
  if (!isFinite(start)) errors.push("Start time is not valid.");
  if (!isFinite(end)) errors.push("End time is not valid.");
  if (isFinite(start) && isFinite(end)) {
    if (end <= start) errors.push("End time must be after start time.");
    if (end > now + 60000) errors.push("End time cannot be in the future.");
  }
  if (validPct(s.startPct) && validPct(s.endPct) && s.type === "usage" && s.endPct > s.startPct) {
    errors.push("A usage session cannot end with more battery than it started with.");
  }
  if (validPct(s.startPct) && validPct(s.endPct) && s.type === "charging" && s.endPct < s.startPct) {
    errors.push("A charging session cannot end with less battery than it started with.");
  }
  if (s.notes !== undefined && s.notes !== null && s.notes !== "" && (typeof s.notes !== "string" || s.notes.length > 500)) {
    errors.push("Notes must be at most 500 characters.");
  }
  return errors;
}

/* Validate starting a live session. */
function validateLiveStart(s, nowMs) {
  const errors = [];
  const now = nowMs === undefined ? Date.now() : nowMs;
  if (!s || typeof s.deviceId !== "string" || !s.deviceId) errors.push("Choose a device.");
  if (s.type !== "usage" && s.type !== "charging") errors.push("Choose a session type.");
  if (!validPct(s.startPct)) errors.push("Starting battery must be between 0 and 100.");
  const start = new Date(s.startTime).getTime();
  if (!isFinite(start)) errors.push("Start time is not valid.");
  else if (start > now + 60000) errors.push("Start time cannot be in the future.");
  return errors;
}

/* Validate stopping a live session (endPct + endTime against the live record). */
function validateLiveStop(live, endPct, endTimeISO, nowMs) {
  const errors = [];
  const now = nowMs === undefined ? Date.now() : nowMs;
  if (!validPct(endPct)) errors.push("Ending battery must be between 0 and 100.");
  const start = new Date(live.startTime).getTime();
  const end = new Date(endTimeISO).getTime();
  if (!isFinite(end)) errors.push("End time is not valid.");
  if (isFinite(start) && isFinite(end)) {
    if (end <= start) errors.push("End time must be after the session start time.");
    if (end > now + 60000) errors.push("End time cannot be in the future.");
  }
  if (validPct(endPct)) {
    if (live.type === "usage" && endPct > live.startPct) {
      errors.push("A usage session cannot end with more battery than it started with.");
    }
    if (live.type === "charging" && endPct < live.startPct) {
      errors.push("A charging session cannot end with less battery than it started with.");
    }
  }
  return errors;
}

/* ---------- CSV ---------- */
function sanitizeCsvCell(value) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@\t\r\n]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildCsv(devices, sessions) {
  const byId = {};
  for (const d of devices) byId[d.id] = d;
  const rows = [["Device", "Type", "Start battery (%)", "End battery (%)", "Start time", "End time", "Duration (min)", "Change (%)", "Rate (%/h)", "Notes"]];
  const sorted = sessions.slice().sort(function (a, b) { return new Date(a.startTime) - new Date(b.startTime); });
  for (const s of sorted) {
    const dev = byId[s.deviceId];
    const dur = s.status === "completed" ? durationMinutes(s.startTime, s.endTime) : null;
    const delta = s.status === "completed" ? pctDelta(s.type, s.startPct, s.endPct) : "";
    const rate = s.status === "completed" ? ratePerHour(delta, dur) : null;
    rows.push([
      dev ? dev.name : "(deleted device)",
      s.type,
      s.startPct,
      s.status === "completed" ? s.endPct : "",
      s.startTime,
      s.status === "completed" ? s.endTime : "",
      dur === null ? "" : Math.round(dur * 10) / 10,
      delta === "" ? "" : delta,
      rate === null ? "" : Math.round(rate * 100) / 100,
      s.notes || ""
    ]);
  }
  return rows.map(function (r) { return r.map(sanitizeCsvCell).join(","); }).join("\r\n") + "\r\n";
}

/* ---------- JSON backup ---------- */
function buildBackup(devices, sessions) {
  return { schema: 1, app: "chargecycle", exportedAt: new Date().toISOString(), devices: devices, sessions: sessions };
}

function validateBackup(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["Backup file is not a valid ChargeCycle backup."];
  if (data.schema !== 1) errors.push("Unsupported backup schema. Expected schema 1.");
  if (data.app !== "chargecycle") errors.push("This backup is not from ChargeCycle.");
  if (!Array.isArray(data.devices)) errors.push("Backup has no devices list.");
  if (!Array.isArray(data.sessions)) errors.push("Backup has no sessions list.");
  if (errors.length) return errors;
  const deviceIds = new Set();
  for (const d of data.devices) {
    const errs = validateDevice(d);
    if (typeof d.id !== "string" || !d.id) errs.push("Device is missing an id.");
    if (errs.length) errors.push("Invalid device '" + (d && d.name ? d.name : "?") + "': " + errs.join(" "));
    else deviceIds.add(d.id);
  }
  for (const s of data.sessions) {
    if (typeof s.id !== "string" || !s.id) { errors.push("A session is missing an id."); continue; }
    if (!deviceIds.has(s.deviceId)) { errors.push("Session '" + s.id + "' refers to an unknown device."); continue; }
    if (s.status === "completed") {
      const errs = validateSession(s, Date.now() + 86400000 * 3650);
      if (errs.length) errors.push("Invalid session '" + s.id + "': " + errs.join(" "));
    } else if (s.status === "live") {
      const errs = validateLiveStart(s, Date.now() + 86400000 * 3650);
      if (errs.length) errors.push("Invalid live session '" + s.id + "': " + errs.join(" "));
    } else {
      errors.push("Session '" + s.id + "' has an unknown status.");
    }
  }
  return errors;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    validPct, durationMinutes, formatDuration, formatHours, pctDelta, ratePerHour,
    estimatedRuntimeHours, deviceStats, validateDevice, validateSession,
    validateLiveStart, validateLiveStop, sanitizeCsvCell, buildCsv,
    buildBackup, validateBackup
  };
}
