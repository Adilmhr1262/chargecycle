# ChargeCycle

A personal device charging and battery performance tracker. Record charging
sessions and battery usage for your phones, laptops, earbuds, smartwatches
and other rechargeable devices, and see how long they actually last — from
your own records only.

## Features

- **Dashboard** — total devices, active and completed sessions, estimated
  battery life per device (clearly labelled as an estimate), recent activity.
- **My Devices** — add, edit and delete devices (name, brand, model,
  category, battery capacity, notes). Deleting a device deletes its sessions
  too, so no orphaned records remain.
- **Session Tracker** — record past usage and charging sessions, or start a
  live session that keeps running across page reloads. Calculates duration,
  battery used or gained, average consumption per hour, average charging rate
  per hour, and estimated full-battery runtime.
- **History & Settings** — search and filter sessions by device, type and
  date; edit or delete completed sessions; export sessions as CSV; export and
  restore full JSON backups (invalid backups are rejected without data loss);
  light and dark mode; delete all data with a typed DELETE confirmation.

## How estimates work

Estimated runtime is calculated from your recorded usage sessions: total
battery consumed divided by total usage time gives an average consumption rate,
and 100% divided by that rate gives the estimated full-battery runtime. It is
an estimate from your records only — not a guarantee of battery health or
performance.

## Tech

- HTML5, CSS3 and vanilla JavaScript only. No frameworks, no backend, no
  external requests.
- IndexedDB for persistent storage; localStorage for the theme preference.
- Service worker caches the app shell so it works offline after the first load.
- No accounts, no tracking, no sample or mock data — the app starts empty.

## Run locally

Serve the folder over HTTP (service workers need a secure context) and open
`index.html`, for example:

```sh
python3 -m http.server 8000
```

## Files

- `index.html` — app shell and views
- `styles.css` — styling, light and dark themes
- `app.js` — UI and wiring
- `db.js` — IndexedDB storage layer
- `calculations.js` — session math, validation, CSV and backup helpers
- `sw.js` — offline service worker
- `manifest.webmanifest` — installable app manifest
