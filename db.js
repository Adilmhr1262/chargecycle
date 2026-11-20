/* ChargeCycle - IndexedDB storage layer. Plain promises, no DOM. */
"use strict";

const DB_NAME = "chargecycle";
const DB_VERSION = 1;

function openDb() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains("devices")) {
        db.createObjectStore("devices", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", { keyPath: "id" });
        s.createIndex("deviceId", "deviceId", { unique: false });
        s.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function tx(db, stores, mode) {
  return db.transaction(stores, mode || "readonly");
}

function reqAsPromise(req) {
  return new Promise(function (resolve, reject) {
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
}

async function getAll(store) {
  const db = await openDb();
  try {
    return await reqAsPromise(tx(db, [store]).objectStore(store).getAll());
  } finally { db.close(); }
}

async function put(store, value) {
  const db = await openDb();
  try {
    await reqAsPromise(tx(db, [store], "readwrite").objectStore(store).put(value));
  } finally { db.close(); }
}

async function remove(store, id) {
  const db = await openDb();
  try {
    await reqAsPromise(tx(db, [store], "readwrite").objectStore(store).delete(id));
  } finally { db.close(); }
}

/* Devices */
async function listDevices() { return getAll("devices"); }
async function saveDevice(device) { await put("devices", device); }

async function deleteDevice(id) {
  const db = await openDb();
  try {
    const t = tx(db, ["devices", "sessions"], "readwrite");
    const sessionsStore = t.objectStore("sessions");
    const idx = sessionsStore.index("deviceId");
    const keys = await reqAsPromise(idx.getAllKeys(id));
    for (const k of keys) await reqAsPromise(sessionsStore.delete(k));
    await reqAsPromise(t.objectStore("devices").delete(id));
    await new Promise(function (resolve, reject) {
      t.oncomplete = resolve; t.onerror = function () { reject(t.error); };
    });
  } finally { db.close(); }
}

/* Sessions */
async function listSessions() { return getAll("sessions"); }
async function saveSession(session) { await put("sessions", session); }
async function deleteSession(id) { await remove("sessions", id); }

async function listLiveSessions() {
  const db = await openDb();
  try {
    const idx = tx(db, ["sessions"]).objectStore("sessions").index("status");
    return await reqAsPromise(idx.getAll("live"));
  } finally { db.close(); }
}

/* Replace everything (used only after a backup passes strict validation). */
async function replaceAll(devices, sessions) {
  const db = await openDb();
  try {
    const t = tx(db, ["devices", "sessions"], "readwrite");
    await reqAsPromise(t.objectStore("devices").clear());
    await reqAsPromise(t.objectStore("sessions").clear());
    for (const d of devices) await reqAsPromise(t.objectStore("devices").put(d));
    for (const s of sessions) await reqAsPromise(t.objectStore("sessions").put(s));
    await new Promise(function (resolve, reject) {
      t.oncomplete = resolve; t.onerror = function () { reject(t.error); };
    });
  } finally { db.close(); }
}

async function clearAll() {
  const db = await openDb();
  try {
    const t = tx(db, ["devices", "sessions"], "readwrite");
    await reqAsPromise(t.objectStore("devices").clear());
    await reqAsPromise(t.objectStore("sessions").clear());
    await new Promise(function (resolve, reject) {
      t.oncomplete = resolve; t.onerror = function () { reject(t.error); };
    });
  } finally { db.close(); }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DB_NAME, DB_VERSION, newId };
}
