/* ChargeCycle - UI and wiring. Uses globals from calculations.js and db.js. */
"use strict";
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var state = { devices: [], sessions: [], view: "dashboard" };
  var THEME_KEY = "chargecycle-theme";

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function toLocalInput(iso) {
    var d = new Date(iso);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function fromLocalInput(v) { return new Date(v).toISOString(); }
  function fmtTime(iso) {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  }
  function fmtDateLocal(iso) {
    var d = new Date(iso);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function deviceName(id) {
    var d = state.devices.find(function (x) { return x.id === id; });
    return d ? d.name : "(deleted device)";
  }

  /* ---------- status ---------- */
  var statusTimer = null;
  function showStatus(msg, isError) {
    var el = $("status");
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { el.textContent = ""; el.classList.remove("error"); }, 6000);
  }

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var dark = theme === "dark";
    $("themeToggle").setAttribute("aria-pressed", dark ? "true" : "false");
    $("themeLabel").textContent = dark ? "Light mode" : "Dark mode";
    $("themeToggle2").textContent = dark ? "Switch to light mode" : "Switch to dark mode";
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* storage unavailable */ }
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (saved === "dark" || saved === "light") applyTheme(saved);
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) applyTheme("dark");
    else applyTheme("light");
  }

  /* ---------- views ---------- */
  function switchView(name) {
    state.view = name;
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = v.id !== "view-" + name; });
    document.querySelectorAll(".nav-btn[data-view]").forEach(function (b) {
      var active = b.getAttribute("data-view") === name;
      b.classList.toggle("is-active", active);
      if (b.closest(".sidebar")) b.setAttribute("aria-current", active ? "page" : "false");
      if (!active && b.closest(".sidebar")) b.removeAttribute("aria-current");
    });
    if (name === "dashboard") renderDashboard();
    if (name === "devices") renderDevices();
    if (name === "tracker") renderTracker();
    if (name === "history") renderHistory();
  }

  /* ---------- shared bits ---------- */
  function sessionFigures(s) {
    if (s.status !== "completed") return "";
    var dur = durationMinutes(s.startTime, s.endTime);
    var delta = pctDelta(s.type, s.startPct, s.endPct);
    var rate = ratePerHour(delta, dur);
    var verb = s.type === "usage" ? "Used" : "Gained";
    var out = verb + " " + delta + "% in " + formatDuration(dur);
    if (rate !== null) out += " · " + (Math.round(rate * 10) / 10) + "%/h";
    return out;
  }

  function sessionRowHtml(s, opts) {
    var live = s.status === "live";
    var pctText = live ? esc(s.startPct) + "% · live" : esc(s.startPct) + "% → " + esc(s.endPct) + "%";
    var timeText = live
      ? "Started " + fmtTime(s.startTime) + " · running <span class=\"elapsed\" data-live-start=\"" + esc(s.startTime) + "\"></span>"
      : fmtTime(s.startTime) + " – " + fmtTime(s.endTime) + " · " + formatDuration(durationMinutes(s.startTime, s.endTime));
    var html = "<div class=\"card session-row\">" +
      "<div class=\"grow\">" +
      "<span class=\"session-type" + (s.type === "charging" ? " charging" : "") + "\">" + (s.type === "charging" ? "Charging" : "Battery usage") + "</span> " +
      (live ? "<span class=\"live-badge\">Live</span>" : "") +
      "<p class=\"session-meta\"><strong>" + esc(deviceName(s.deviceId)) + "</strong> · " + pctText + "</p>" +
      "<p class=\"session-meta\">" + timeText + "</p>" +
      (live ? "" : "<p class=\"session-figures\">" + esc(sessionFigures(s)) + "</p>") +
      (s.notes ? "<p class=\"session-meta\">" + esc(s.notes) + "</p>" : "") +
      "</div><div class=\"card-actions\">";
    if (live && opts && opts.stop) {
      html += "<button type=\"button\" class=\"btn btn-primary btn-small\" data-stop=\"" + esc(s.id) + "\">Stop</button>";
      html += "<button type=\"button\" class=\"btn btn-secondary btn-small\" data-discard-live=\"" + esc(s.id) + "\">Discard</button>";
    }
    if (!live && opts && opts.edit) {
      html += "<button type=\"button\" class=\"btn btn-secondary btn-small\" data-edit-session=\"" + esc(s.id) + "\">Edit</button>";
      html += "<button type=\"button\" class=\"btn btn-secondary btn-small\" data-delete-session=\"" + esc(s.id) + "\">Delete</button>";
    }
    return html + "</div></div>";
  }

  function fillDeviceSelects(selectedId) {
    var filterVal = $("filterDevice") ? $("filterDevice").value : "";
    var opts = state.devices.map(function (d) {
      return "<option value=\"" + esc(d.id) + "\"" + (d.id === selectedId ? " selected" : "") + ">" + esc(d.name) + "</option>";
    }).join("");
    var empty = "<option value=\"\" disabled" + (state.devices.length ? "" : " selected") + ">No devices yet — add one first</option>";
    ["liveDevice", "manualDevice", "editDevice"].forEach(function (id) {
      $(id).innerHTML = state.devices.length ? opts : empty;
      if (selectedId && id === "editDevice") $(id).value = selectedId;
    });
    var f = $("filterDevice");
    f.innerHTML = "<option value=\"\">All devices</option>" + state.devices.map(function (d) {
      return "<option value=\"" + esc(d.id) + "\">" + esc(d.name) + "</option>";
    }).join("");
    if (filterVal) f.value = filterVal;
  }

  /* ---------- dashboard ---------- */
  function renderDashboard() {
    var live = state.sessions.filter(function (s) { return s.status === "live"; });
    var completed = state.sessions.filter(function (s) { return s.status === "completed"; });
    var runtimes = state.devices.map(function (d) {
      var stats = deviceStats(state.sessions.filter(function (s) { return s.deviceId === d.id; }));
      return { device: d, stats: stats };
    }).filter(function (r) { return r.stats.estimatedRuntimeHours !== null; });
    var avgRuntime = runtimes.length
      ? runtimes.reduce(function (a, r) { return a + r.stats.estimatedRuntimeHours; }, 0) / runtimes.length
      : null;

    $("statGrid").innerHTML =
      statCard("Total devices", state.devices.length, state.devices.length ? "" : "Add your first device to start tracking.") +
      statCard("Active sessions", live.length, live.length ? "Live right now." : "No live sessions.") +
      statCard("Completed sessions", completed.length, completed.length ? "" : "No sessions recorded yet.") +
      statCard("Avg. estimated battery life", avgRuntime === null ? "—" : formatHours(avgRuntime),
        avgRuntime === null ? "Record usage sessions to see estimates." : "Estimated, from your usage records.");

    var rl = $("runtimeList");
    if (!state.devices.length) {
      rl.innerHTML = emptyHtml("No devices yet.", "Add your first device to start tracking battery life.", "devices");
    } else {
      rl.innerHTML = state.devices.map(function (d) {
        var stats = deviceStats(state.sessions.filter(function (s) { return s.deviceId === d.id; }));
        var est = stats.estimatedRuntimeHours === null ? "Not enough data yet" : "Estimated " + formatHours(stats.estimatedRuntimeHours);
        return "<div class=\"card session-row\"><div class=\"grow\"><p class=\"session-meta\"><strong>" + esc(d.name) + "</strong></p>" +
          "<p class=\"session-meta\">" + esc(est) + (stats.avgConsumptionPerHour !== null ? " · uses about " + (Math.round(stats.avgConsumptionPerHour * 10) / 10) + "% per hour" : "") + "</p></div>" +
          "<div class=\"card-actions\"><button type=\"button\" class=\"btn btn-secondary btn-small\" data-goto-tracker=\"" + esc(d.id) + "\">Track</button></div></div>";
      }).join("");
    }

    var allRecent = state.sessions.slice().sort(function (a, b) { return new Date(b.startTime) - new Date(a.startTime); }).slice(0, 8);
    var show = allRecent.length ? allRecent : [];
    $("recentList").innerHTML = show.length
      ? show.map(function (s) { return sessionRowHtml(s, { stop: true }); }).join("")
      : emptyHtml("Nothing recorded yet.", "Start a live session or record a past session to see it here.", "tracker");
  }

  function statCard(label, value, note) {
    return "<div class=\"stat-card\"><p class=\"stat-label\">" + esc(label) + "</p>" +
      "<p class=\"stat-value\">" + esc(value) + "</p>" +
      (note ? "<p class=\"stat-note\">" + esc(note) + "</p>" : "") + "</div>";
  }

  function emptyHtml(title, text, gotoView) {
    return "<div class=\"empty\"><p><strong>" + esc(title) + "</strong></p><p>" + esc(text) + "</p>" +
      (gotoView ? "<button type=\"button\" class=\"btn btn-primary\" data-goto=\"" + esc(gotoView) + "\">Go there</button>" : "") + "</div>";
  }

  /* ---------- devices ---------- */
  function renderDevices() {
    var grid = $("deviceGrid");
    if (!state.devices.length) {
      grid.innerHTML = emptyHtml("No devices yet.", "Add your first phone, laptop or gadget to start tracking its battery.", null);
      return;
    }
    grid.innerHTML = state.devices.map(function (d) {
      var sessions = state.sessions.filter(function (s) { return s.deviceId === d.id; });
      var stats = deviceStats(sessions);
      var est = stats.estimatedRuntimeHours === null ? "—" : "Estimated " + formatHours(stats.estimatedRuntimeHours);
      var meta = [d.brand, d.model, d.category].filter(Boolean).join(" · ");
      if (d.capacityMah) meta += (meta ? " · " : "") + d.capacityMah + " mAh";
      return "<article class=\"card device-card\"><h3>" + esc(d.name) + "</h3>" +
        "<p class=\"device-meta\">" + esc(meta || "No details") + "</p>" +
        "<div class=\"device-stats\">" +
        "<span class=\"stat\"><b>" + stats.totalSessions + "</b>sessions</span>" +
        "<span class=\"stat\"><b>" + (stats.avgConsumptionPerHour === null ? "—" : (Math.round(stats.avgConsumptionPerHour * 10) / 10) + "%/h") + "</b>avg use</span>" +
        "<span class=\"stat\"><b>" + (stats.avgChargeRatePerHour === null ? "—" : (Math.round(stats.avgChargeRatePerHour * 10) / 10) + "%/h") + "</b>avg charge</span>" +
        "<span class=\"stat\"><b>" + esc(est) + "</b>battery life</span>" +
        "</div>" +
        (d.notes ? "<p class=\"device-notes\">" + esc(d.notes) + "</p>" : "") +
        "<div class=\"card-actions\">" +
        "<button type=\"button\" class=\"btn btn-secondary btn-small\" data-edit-device=\"" + esc(d.id) + "\">Edit</button>" +
        "<button type=\"button\" class=\"btn btn-secondary btn-small\" data-delete-device=\"" + esc(d.id) + "\">Delete</button>" +
        "<button type=\"button\" class=\"btn btn-primary btn-small\" data-goto-tracker=\"" + esc(d.id) + "\">Track</button>" +
        "</div></article>";
    }).join("");
  }

  /* ---------- tracker ---------- */
  function renderTracker() {
    fillDeviceSelects();
    var live = state.sessions.filter(function (s) { return s.status === "live"; })
      .sort(function (a, b) { return new Date(b.startTime) - new Date(a.startTime); });
    $("liveList").innerHTML = live.length
      ? live.map(function (s) { return sessionRowHtml(s, { stop: true }); }).join("")
      : "<div class=\"empty\"><p><strong>No live sessions.</strong></p><p>Start one below and it keeps running even if you reload the page.</p></div>";
    tickLive();
  }

  function tickLive() {
    var now = Date.now();
    document.querySelectorAll("[data-live-start]").forEach(function (el) {
      var mins = (now - new Date(el.getAttribute("data-live-start")).getTime()) / 60000;
      el.textContent = formatDuration(Math.max(0, mins)) + " elapsed";
    });
  }

  /* ---------- history ---------- */
  function renderHistory() {
    fillDeviceSelects();
    var q = $("filterSearch").value.trim().toLowerCase();
    var dev = $("filterDevice").value;
    var type = $("filterType").value;
    var date = $("filterDate").value;
    var list = state.sessions.slice().sort(function (a, b) { return new Date(b.startTime) - new Date(a.startTime); });
    list = list.filter(function (s) {
      if (dev && s.deviceId !== dev) return false;
      if (type && s.type !== type) return false;
      if (date && fmtDateLocal(s.startTime) !== date) return false;
      if (q) {
        var hay = (deviceName(s.deviceId) + " " + (s.notes || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    $("historyList").innerHTML = list.length
      ? list.map(function (s) { return sessionRowHtml(s, { stop: true, edit: true }); }).join("")
      : "<div class=\"empty\"><p><strong>No sessions match.</strong></p><p>Try different filters, or record a session.</p></div>";
  }

  function renderAll() {
    renderDashboard(); renderDevices(); renderTracker(); renderHistory();
  }

  /* ---------- data ---------- */
  async function loadAll() {
    state.devices = await listDevices();
    state.sessions = await listSessions();
    state.devices.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  }

  /* ---------- dialogs ---------- */
  var confirmAction = null;
  function openConfirm(title, text, yesLabel, action) {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmYes").textContent = yesLabel;
    confirmAction = action;
    $("confirmDialog").showModal();
  }
  document.querySelectorAll("[data-close]").forEach(function (btn) {
    btn.addEventListener("click", function () { btn.closest("dialog").close(); });
  });

  function showFieldError(el, messages) {
    if (!messages || !messages.length) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = messages.join(" ");
  }

  /* Device form */
  $("addDeviceBtn").addEventListener("click", function () {
    $("deviceDialogTitle").textContent = "Add device";
    $("deviceForm").reset();
    $("deviceId").value = "";
    showFieldError($("deviceError"), null);
    $("deviceDialog").showModal();
  });

  function openEditDevice(id) {
    var d = state.devices.find(function (x) { return x.id === id; });
    if (!d) return;
    $("deviceDialogTitle").textContent = "Edit device";
    $("deviceId").value = d.id;
    $("deviceName").value = d.name;
    $("deviceBrand").value = d.brand || "";
    $("deviceModel").value = d.model || "";
    $("deviceCategory").value = d.category;
    $("deviceCapacity").value = d.capacityMah || "";
    $("deviceNotes").value = d.notes || "";
    showFieldError($("deviceError"), null);
    $("deviceDialog").showModal();
  }

  $("deviceForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var capRaw = $("deviceCapacity").value.trim();
    var data = {
      id: $("deviceId").value || newId(),
      name: $("deviceName").value.trim(),
      brand: $("deviceBrand").value.trim(),
      model: $("deviceModel").value.trim(),
      category: $("deviceCategory").value,
      capacityMah: capRaw === "" ? null : Number(capRaw),
      notes: $("deviceNotes").value.trim(),
      createdAt: new Date().toISOString()
    };
    var existing = state.devices.find(function (x) { return x.id === data.id; });
    if (existing) data.createdAt = existing.createdAt;
    var errors = validateDevice(data);
    if (errors.length) { showFieldError($("deviceError"), errors); return; }
    try {
      await saveDevice(data);
      await loadAll(); renderAll();
      $("deviceDialog").close();
      showStatus(existing ? "Device updated." : "Device added.");
    } catch (err) { showFieldError($("deviceError"), ["Could not save the device. Please try again."]); }
  });

  /* Live session form */
  $("liveForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var data = {
      id: newId(),
      deviceId: $("liveDevice").value,
      type: $("liveType").value,
      startPct: Number($("liveStartPct").value),
      endPct: null,
      startTime: $("liveStartTime").value ? fromLocalInput($("liveStartTime").value) : "",
      endTime: null,
      status: "live",
      notes: "",
      createdAt: new Date().toISOString()
    };
    var errors = validateLiveStart(data);
    if (errors.length) { showFieldError($("liveError"), errors); return; }
    try {
      await saveSession(data);
      await loadAll(); renderAll();
      $("liveForm").reset();
      setDefaultTimes();
      showStatus("Live session started.");
    } catch (err) { showFieldError($("liveError"), ["Could not start the session. Please try again."]); }
  });

  /* Manual session form */
  $("manualForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var data = {
      id: newId(),
      deviceId: $("manualDevice").value,
      type: $("manualType").value,
      startPct: Number($("manualStartPct").value),
      endPct: Number($("manualEndPct").value),
      startTime: $("manualStartTime").value ? fromLocalInput($("manualStartTime").value) : "",
      endTime: $("manualEndTime").value ? fromLocalInput($("manualEndTime").value) : "",
      status: "completed",
      notes: $("manualNotes").value.trim(),
      createdAt: new Date().toISOString()
    };
    var errors = validateSession(data);
    if (errors.length) { showFieldError($("manualError"), errors); return; }
    try {
      await saveSession(data);
      await loadAll(); renderAll();
      $("manualForm").reset();
      setDefaultTimes();
      showStatus("Session saved.");
    } catch (err) { showFieldError($("manualError"), ["Could not save the session. Please try again."]); }
  });

  /* Stop live session */
  function openStopDialog(id) {
    var s = state.sessions.find(function (x) { return x.id === id; });
    if (!s) return;
    $("stopSessionId").value = s.id;
    $("stopSummary").textContent = deviceName(s.deviceId) + " · " + (s.type === "charging" ? "Charging" : "Battery usage") +
      " · started at " + s.startPct + "% on " + fmtTime(s.startTime) + ".";
    $("stopEndPct").value = "";
    $("stopEndTime").value = toLocalInput(new Date().toISOString());
    showFieldError($("stopError"), null);
    $("stopDialog").showModal();
  }

  $("stopForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var id = $("stopSessionId").value;
    var live = state.sessions.find(function (x) { return x.id === id; });
    if (!live) { $("stopDialog").close(); return; }
    var endPct = Number($("stopEndPct").value);
    var endTime = $("stopEndTime").value ? fromLocalInput($("stopEndTime").value) : "";
    var errors = validateLiveStop(live, endPct, endTime);
    if (errors.length) { showFieldError($("stopError"), errors); return; }
    var done = Object.assign({}, live, { endPct: endPct, endTime: endTime, status: "completed" });
    try {
      await saveSession(done);
      await loadAll(); renderAll();
      $("stopDialog").close();
      var delta = pctDelta(done.type, done.startPct, done.endPct);
      var dur = durationMinutes(done.startTime, done.endTime);
      var rate = ratePerHour(delta, dur);
      showStatus("Session stopped: " + (done.type === "usage" ? "used " : "gained ") + delta + "% in " +
        formatDuration(dur) + (rate !== null ? " (" + (Math.round(rate * 10) / 10) + "%/h)" : "") + ".");
    } catch (err) { showFieldError($("stopError"), ["Could not stop the session. Please try again."]); }
  });

  /* Edit session */
  function openEditSession(id) {
    var s = state.sessions.find(function (x) { return x.id === id && x.status === "completed"; });
    if (!s) return;
    $("editSessionId").value = s.id;
    fillDeviceSelects(s.deviceId);
    $("editDevice").value = s.deviceId;
    $("editType").value = s.type;
    $("editStartPct").value = s.startPct;
    $("editEndPct").value = s.endPct;
    $("editStartTime").value = toLocalInput(s.startTime);
    $("editEndTime").value = toLocalInput(s.endTime);
    $("editNotes").value = s.notes || "";
    showFieldError($("editError"), null);
    $("editSessionDialog").showModal();
  }

  $("editSessionForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var id = $("editSessionId").value;
    var orig = state.sessions.find(function (x) { return x.id === id; });
    if (!orig) { $("editSessionDialog").close(); return; }
    var data = {
      id: id,
      deviceId: $("editDevice").value,
      type: $("editType").value,
      startPct: Number($("editStartPct").value),
      endPct: Number($("editEndPct").value),
      startTime: $("editStartTime").value ? fromLocalInput($("editStartTime").value) : "",
      endTime: $("editEndTime").value ? fromLocalInput($("editEndTime").value) : "",
      status: "completed",
      notes: $("editNotes").value.trim(),
      createdAt: orig.createdAt
    };
    var errors = validateSession(data);
    if (errors.length) { showFieldError($("editError"), errors); return; }
    try {
      await saveSession(data);
      await loadAll(); renderAll();
      $("editSessionDialog").close();
      showStatus("Session updated.");
    } catch (err) { showFieldError($("editError"), ["Could not save the session. Please try again."]); }
  });

  /* Confirm dialog submit */
  $("confirmForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var action = confirmAction;
    confirmAction = null;
    $("confirmDialog").close();
    if (action) action();
  });

  /* Delete all */
  $("deleteAllBtn").addEventListener("click", function () {
    $("deleteAllConfirm").value = "";
    $("deleteAllYes").disabled = true;
    showFieldError($("deleteAllError"), null);
    $("deleteAllDialog").showModal();
  });
  $("deleteAllConfirm").addEventListener("input", function () {
    $("deleteAllYes").disabled = $("deleteAllConfirm").value.trim() !== "DELETE";
  });
  $("deleteAllForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    if ($("deleteAllConfirm").value.trim() !== "DELETE") {
      showFieldError($("deleteAllError"), ["Type DELETE to confirm."]);
      return;
    }
    try {
      await clearAll();
      await loadAll(); renderAll();
      $("deleteAllDialog").close();
      showStatus("All data deleted.");
    } catch (err) { showFieldError($("deleteAllError"), ["Could not delete the data. Please try again."]); }
  });

  /* ---------- exports / import ---------- */
  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  $("exportCsvBtn").addEventListener("click", function () {
    download("chargecycle-sessions.csv", buildCsv(state.devices, state.sessions), "text/csv");
    showStatus("CSV exported.");
  });
  $("exportJsonBtn").addEventListener("click", function () {
    download("chargecycle-backup.json", JSON.stringify(buildBackup(state.devices, state.sessions), null, 2), "application/json");
    showStatus("Backup exported.");
  });
  $("importJsonInput").addEventListener("change", async function () {
    var file = $("importJsonInput").files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var data = JSON.parse(text);
      var errors = validateBackup(data);
      if (errors.length) { showStatus("Backup rejected: " + errors[0], true); return; }
      await replaceAll(data.devices, data.sessions);
      await loadAll(); renderAll();
      showStatus("Backup restored: " + data.devices.length + " devices, " + data.sessions.length + " sessions.");
    } catch (err) {
      showStatus("Backup rejected: the file is not a valid ChargeCycle backup.", true);
    } finally {
      $("importJsonInput").value = "";
    }
  });

  /* ---------- filters ---------- */
  ["filterSearch", "filterDevice", "filterType", "filterDate"].forEach(function (id) {
    $(id).addEventListener("input", renderHistory);
    $(id).addEventListener("change", renderHistory);
  });
  $("clearFilters").addEventListener("click", function () {
    $("filterSearch").value = ""; $("filterDevice").value = "";
    $("filterType").value = ""; $("filterDate").value = "";
    renderHistory();
  });

  /* ---------- global click delegation ---------- */
  document.addEventListener("click", async function (e) {
    var t = e.target.closest("[data-view], [data-goto], [data-goto-tracker], [data-edit-device], [data-delete-device], [data-edit-session], [data-delete-session], [data-stop], [data-discard-live]");
    if (!t) return;
    if (t.hasAttribute("data-view")) { switchView(t.getAttribute("data-view")); return; }
    if (t.hasAttribute("data-goto")) { switchView(t.getAttribute("data-goto")); return; }
    if (t.hasAttribute("data-goto-tracker")) {
      switchView("tracker");
      var sel = $("manualDevice");
      if (sel) sel.value = t.getAttribute("data-goto-tracker");
      var liveSel = $("liveDevice");
      if (liveSel) liveSel.value = t.getAttribute("data-goto-tracker");
      return;
    }
    if (t.hasAttribute("data-edit-device")) { openEditDevice(t.getAttribute("data-edit-device")); return; }
    if (t.hasAttribute("data-delete-device")) {
      var id = t.getAttribute("data-delete-device");
      var d = state.devices.find(function (x) { return x.id === id; });
      var n = state.sessions.filter(function (s) { return s.deviceId === id; }).length;
      openConfirm("Delete device?", "Delete " + (d ? d.name : "this device") + " and its " + n + " session" + (n === 1 ? "" : "s") + "? This cannot be undone.", "Delete", async function () {
        await deleteDevice(id);
        await loadAll(); renderAll();
        showStatus("Device deleted.");
      });
      return;
    }
    if (t.hasAttribute("data-edit-session")) { openEditSession(t.getAttribute("data-edit-session")); return; }
    if (t.hasAttribute("data-delete-session")) {
      var sid = t.getAttribute("data-delete-session");
      openConfirm("Delete session?", "Delete this session? This cannot be undone.", "Delete", async function () {
        await deleteSession(sid);
        await loadAll(); renderAll();
        showStatus("Session deleted.");
      });
      return;
    }
    if (t.hasAttribute("data-stop")) { openStopDialog(t.getAttribute("data-stop")); return; }
    if (t.hasAttribute("data-discard-live")) {
      var lid = t.getAttribute("data-discard-live");
      openConfirm("Discard live session?", "Discard this live session without saving it?", "Discard", async function () {
        await deleteSession(lid);
        await loadAll(); renderAll();
        showStatus("Live session discarded.");
      });
      return;
    }
  });

  /* ---------- theme buttons ---------- */
  $("themeToggle").addEventListener("click", toggleTheme);
  $("themeToggle2").addEventListener("click", toggleTheme);

  /* ---------- defaults ---------- */
  function setDefaultTimes() {
    var now = toLocalInput(new Date().toISOString());
    $("liveStartTime").value = now;
    $("manualEndTime").value = now;
    var oneHourAgo = toLocalInput(new Date(Date.now() - 3600000).toISOString());
    $("manualStartTime").value = oneHourAgo;
  }

  /* ---------- init ---------- */
  async function init() {
    initTheme();
    document.querySelectorAll(".nav-btn[data-view]").forEach(function (b) {
      b.addEventListener("click", function () { switchView(b.getAttribute("data-view")); });
    });
    setDefaultTimes();
    try {
      await loadAll();
    } catch (err) {
      showStatus("Could not open local storage. The app needs IndexedDB to save your data.", true);
    }
    renderAll();
    setInterval(tickLive, 1000);
    if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline support optional */ });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
