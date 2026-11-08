# Architecture

Local Sky has a small dependency-free frontend and two interchangeable backends.

## Request flow

1. The browser loads static files from `public/`.
2. `GET /api/auth/me` establishes the current account.
3. Dashboard calls go to `/api/weather`, `/api/locations`, `/api/geocode` and
   `/api/settings`.
4. Each account resolves to its own board file (or D1 rows when hosted).

## Local backend

- `src/server.js` — HTTP server, static files, route gating and redirects.
- `src/auth/` — scrypt password hashes and session-cookie helpers.
- `src/routes/` — JSON API and authentication routes.
- `src/db/` — atomic JSON store plus per-account boards and locations.
- `src/weather/` — Open-Meteo client, normalisation, caching and deterministic
  offline generator.

## Hosted backend

- `worker/index.js` — Cloudflare Worker entrypoint and route dispatch.
- `worker/auth.js` — D1 accounts, PBKDF2-SHA256 hashes and sessions.
- `worker/board.js` — D1 board storage.
- `sites.manifest.json` — Worker bundle and static-asset deployment manifest.

## Frontend

- `public/index.html`, `public/styles.css`, `public/app.js` — dashboard.
- `public/auth.html`, `public/auth.css`, `public/auth.js` — account screens.
- `public/world-map.svg` and `public/world-map-light.svg` — local Natural Earth
  map artwork for both themes.
