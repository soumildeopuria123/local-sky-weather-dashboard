# Local Sky — a live weather dashboard

[![test status](https://github.com/soumildeopuria123/local-sky-weather-dashboard/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/soumildeopuria123/local-sky-weather-dashboard/actions/workflows/test.yml)

**See the new look:** [Open the refreshed Local Sky dashboard ](https://site-02eae6937c2c44fbb69befdf484dd7bf.freebuff.page/signin)

A full-stack weather dashboard that shows **real, live weather** for the cities you
save, plus a built-in generator that keeps the app usable when you are offline.

- **Live data:** [Open-Meteo](https://open-meteo.com/) — current conditions,
  hourly UV and visibility, and a 5-day forecast. **No API key required.**
- **Offline fallback:** if the provider can't be reached, a deterministic local
  engine fills in and every affected card is labelled **offline sample**.
- **Local backend:** Node.js only (built-in `http`, no dependencies)
- **Hosted backend:** Cloudflare Worker + D1, bundled with esbuild
- **Frontend:** vanilla HTML / CSS / JavaScript (no build step)
- **Accounts:** sign up / sign in with salted password hashes (scrypt locally,
  PBKDF2-SHA256 on Workers), 30-day server-side sessions, and a private
  dashboard for each account
- **Sign-in extras:** show/hide passwords, a live password-strength meter, a
  Caps Lock warning, and an optional "remember my email" setting
- **Day / night dashboard:** a sun/moon switch with a saved preference and a
  matching light world map
- **Living dashboard:** condition-aware animated weather icons, a starfield,
  pulsing map pins, staggered card reveals and a pointer-following card glow
- **Storage:** JSON files locally (`data/users.json`, `data/boards/<id>.json`);
  D1 tables when hosted

## Quick start

Requires Node.js 20 or newer. There is nothing to install.

```bash
npm start
# Local Sky listening on http://localhost:3000
```

Open <http://localhost:3000> and create an account (or sign in). Then type a
city (e.g. `Portland`, `Tokyo`, `Reykjavik`) and press **Add place**. City names
are geocoded to real coordinates, so you can also use `Portland, ME` or
`Springfield, Illinois`.

## Share it

The refreshed dashboard is live at **https://site-02eae6937c2c44fbb69befdf484dd7bf.freebuff.page/signin** — a new shareable preview of this version. It uses its own database, so create an account there to explore the new look.

The stable production app is at **https://site-3562ca775bdc45628169d6856046bfa4.freebuff.page/signin**; existing accounts work there, and it now has the same refreshed interface.

Both links always open the sign-in / create-account page; after signing in you
land on your dashboard. Accounts and saved places are separate for each deployment. Open it on any device, create an account and add cities. Accounts, saved places
and settings live in that deployment's D1 database, so the link works without a
server running on your computer. The hosted build is produced from the same
source:

```bash
npm run build:worker                            # dist/worker.js + dist/public/
npx wrangler@4 dev --ip 127.0.0.1 --port 8787    # local D1-backed check
```

`build:worker` copies `public/index.html` to `dist/public/dashboard.html`, which
lets the Worker decide whether `/` shows the dashboard or redirects to sign-in.

Each account has its own cities, units, default city and map pins. If the
dashboard already had cities before accounts were added, the first account to
sign up inherits them and gets a one-time welcome note.

Useful scripts and settings:

```bash
npm start                              # normal mode (live weather)
WEATHER_SOURCE=local npm start         # force offline sample-only mode
PORT=8080 npm start                    # choose another port
DATA_FILE=/tmp/sky.json npm start      # use a different data file
npm test                               # provider + generator + API tests
```

## What you can do

- Create an account on `/signup`, sign in on `/signin`, and sign out from the
  dashboard footer. Sessions last 30 days and are stored server-side.
- New accounts get a personal welcome panel with a shortcut to the search box;
  accounts with saved cities open straight to their map, cards and forecasts.
- Search any city or town as you type and pick the exact match from a list of
  places (name, region, country). Your choice is saved with its real coordinates,
  so two different Springfields are kept apart.
- Save up to 50 places; each keeps its coordinates, region, country and timezone.
- Search covers the whole planet: Open-Meteo geocoding is built on the GeoNames
  database of millions of place names, so villages and remote settlements work,
  and typing a region (`Paris, Texas`) narrows the list.
- See live temperature, feels-like temperature, condition, humidity, wind speed
  and direction, gusts, UV index, pressure, visibility, current rainfall, cloud
  cover, high/low, sunrise, sunset and daylight length.
- See every saved place on a world map, each pin showing its current temperature;
  click a pin to jump to that place's card.
- Browse a 5-day forecast with highs, lows, rain chance and a temperature bar.
- Toggle Celsius/Fahrenheit — temperature, wind, gusts, pressure, visibility and
  rainfall switch units together.
- Switch the dashboard between its night and day themes with the sun/moon
  button; the choice is remembered on that device.
- On the sign-in page, reveal passwords, watch the sign-up strength meter, get a
  Caps Lock reminder, and optionally remember your email on that device.
- Star a city to make it the default (shown first), remove cities, and press
  **Refresh** to pull fresh readings.
- Live readings are cached for 10 minutes; the page refreshes stale data quietly.
- Each card shows whether its data is **live · Open-Meteo** or an
  **offline sample**.

## How it works

### Accounts and privacy

Sign-up requires a name, an email and a password of at least 8 characters.
Passwords are hashed with a random per-user salt — Node's built-in `scrypt`
locally, PBKDF2-SHA256 in the hosted Worker — and the plain password is never
stored. A successful sign-up or sign-in creates a random session token. Only
its SHA-256 hash is stored (in `data/users.json` locally, in D1 when hosted),
and the browser gets the token in an `HttpOnly`, `SameSite=Lax` cookie (marked
`Secure` when the request arrived over HTTPS).

Every dashboard API route requires that session, and the server resolves the
account's own board file before answering, so one account can never read or
change another's cities. Signing out deletes the session both server-side and in
the browser.

This is deliberately small: there is no email verification, password reset or
login rate limiting. Put it behind a throttling reverse proxy before exposing it
to the open internet.

### Live path

1. **Search a place → geocoding.**
   As you type, the dashboard asks `src/weather/live.js` for matching places
   (Open-Meteo geocoding, based on GeoNames) and lists up to ten of them with
   their region and country. Picking one saves that place's exact
   latitude/longitude, region, country and timezone.
   You can also type a name directly and press **Add place**; a comma-separated
   hint (`Portland, Maine`) picks the right match. Unknown names get a friendly
   “couldn't find that city” message.
2. **Weather fetch.**
   `GET /api/weather` asks Open-Meteo for current conditions, hourly UV index,
   hourly visibility and precipitation probability, and a 6-day daily forecast.
   Only city coordinates are sent; there is no personal data.
3. **Normalisation.**
   WMO weather codes map onto the dashboard's own condition model (clear, partly
   cloudy, drizzle, rain, snow, thunderstorm, fog), with night variants for clear
   and partly cloudy. Values are stored canonically in metric units.
4. **Cache + refresh.**
   Readings live in `data/weather.json` with a `storedAt` timestamp and a
   10-minute TTL. Refresh forces a new fetch and bumps the location revision.

### Offline fallback

If geocoding, the weather request, or the provider fails, the request is logged
into the reading as `fallbackReason`, and `src/weather/generator.js` produces a
deterministic sample instead. That engine uses the city's latitude, elevation and
maritime influence plus season, time of day, seeded randomness and solar geometry.
The UI marks these cards **offline sample** and still shows the full detail set, so
nothing goes blank. Run with `WEATHER_SOURCE=local` to use this engine exclusively,
with no network calls at all.

Map land shapes come from [Natural Earth](https://www.naturalearthdata.com/)
(public domain) and are drawn as a local SVG, so the map needs no tile server.

Attribution: live weather data by [Open-Meteo.com](https://open-meteo.com/)
(CC BY 4.0). Their free tier is intended for non-commercial use — check their
terms if you plan to run this publicly at scale.

## Project structure

```
local-weather-dashboard/
├── src/
│   ├── server.js              # HTTP server, sessions, route gating
│   ├── auth/
│   │   ├── accounts.js        # scrypt hashes, accounts and sessions
│   │   └── cookies.js         # cookie parsing and serialising
│   ├── routes/
│   │   ├── api.js             # dashboard JSON API
│   │   ├── auth.js            # sign up / in / out, current user
│   │   └── body.js            # shared JSON body reader
│   ├── weather/
│   │   ├── live.js            # Open-Meteo geocoding, forecast, WMO mapping
│   │   ├── generator.js       # deterministic offline weather engine
│   │   ├── service.js         # live fetch, fallback, caching, revisions
│   │   ├── units.js           # metric ⇄ imperial conversion for display
│   │   └── utils.js           # seeded RNG, solar math, date helpers
│   └── db/
│       ├── store.js           # atomic JSON persistence
│       ├── boards.js          # one dashboard file per account
│       └── locations.js       # location CRUD + validation
├── worker/
│   ├── index.js               # hosted entry: routes, auth, dashboard API
│   ├── auth.js                # D1 accounts, PBKDF2, sessions
│   └── board.js               # D1 dashboard storage
├── sites.manifest.json        # hosted Worker + asset manifest
├── wrangler.toml              # local Worker/D1 configuration
├── public/
│   ├── index.html
│   ├── auth.html              # sign in / create account
│   ├── auth.css               # bright, illustrated auth-page styling
│   ├── auth-scene.svg         # original sunrise-over-the-city artwork
│   ├── styles.css
│   ├── app.js                 # dashboard
│   ├── auth.js                # auth page interactions
│   ├── world-map.svg          # Natural Earth land shapes (public domain)
│   ├── world-map-light.svg    # light-theme map colours
│   └── favicon.svg
├── data/
│   ├── users.json             # accounts + session hashes (git-ignored)
│   ├── boards/<id>.json       # one dashboard per account (git-ignored)
│   └── weather.json           # pre-account dashboard, migrated on first signup
├── test/
│   ├── live.test.js
│   ├── generator.test.js
│   ├── api.test.js
│   └── auth.test.js
└── README.md
```

## API

All routes are served by this project. Everything except `/api/health` and the
`/api/auth/*` routes requires the signed-in session cookie; signed-out callers
get `401` with `auth_required`.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/auth/signup` | Create an account and start a session |
| POST | `/api/auth/signin` | Sign in: `{ "email", "password" }` |
| POST | `/api/auth/signout` | End the current session |
| GET | `/api/auth/me` | The signed-in account |
| GET | `/api/health` | Liveness check (also reports whether live mode is on) |
| GET | `/api/geocode?q=tokyo` | Place suggestions with region, country and coordinates |
| GET | `/api/locations` | Saved locations + settings |
| POST | `/api/locations` | Add a place: `{ "city": "Tokyo" }` or `{ "city": "Tokyo", "place": { … } }` with a picked search result |
| PATCH | `/api/locations/:id` | Set default: `{ "isDefault": true }` |
| DELETE | `/api/locations/:id` | Remove a city |
| GET | `/api/weather` | All locations with current weather + forecast |
| GET | `/api/weather/:id` | One location |
| POST | `/api/weather/refresh` | Force a fresh live fetch for every location |
| PUT | `/api/settings` | `{ "units": "imperial" }` and/or `{ "defaultLocationId": "…" }` |

`GET /api/weather?units=imperial` returns converted values without changing the
saved preference. Errors use `{ "error": { "code": "…", "message": "…" } }` with
messages the UI shows directly.

Trimmed example reading:

```json
{
  "units": "metric",
  "provider": "Open-Meteo",
  "locations": [
    {
      "id": "…",
      "city": "Portland, OR",
      "region": "Oregon",
      "country": "United States",
      "timezone": "America/Los_Angeles",
      "isDefault": true,
      "source": "live",
      "provider": "Open-Meteo",
      "observedAt": "2026-11-06T14:30",
      "fallbackReason": null,
      "current": {
        "temperature": 14.2,
        "feelsLike": 13.1,
        "humidity": 81,
        "windSpeed": 9.4,
        "windDirection": "SW",
        "gusts": 19,
        "pressure": 1016,
        "uvIndex": 2,
        "visibility": 23.1,
        "precipitation": 0.2,
        "precipitationChance": 38,
        "cloudCover": 72,
        "condition": { "id": "partly-cloudy", "label": "Partly cloudy", "icon": "partly-cloudy", "tone": "cloudy" },
        "high": 16,
        "low": 9
      },
      "forecast": [
        { "date": "2026-11-06", "high": 16, "low": 9, "precipitationChance": 38, "condition": { "…": "…" } }
      ],
      "sun": { "sunrise": "07:41", "sunset": "16:52", "daylightHours": 9.2, "polar": null },
      "updatedAt": "2026-11-06T18:02:11.000Z"
    }
  ]
}
```

When Open-Meteo is unreachable the same location returns `"source": "sample"`,
`"provider": "local engine"` and a `fallbackReason`.

## Data model

Locally, `data/users.json` holds accounts and session hashes (the hosted Worker
keeps the same fields in the D1 `users`, `sessions` and `boards` tables):

```json
{
  "version": 1,
  "users": [
    {
      "id": "uuid",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "passwordHash": "scrypt-hash-hex",
      "salt": "random-hex",
      "createdAt": "…"
    }
  ],
  "sessions": [
    { "tokenHash": "sha256-hex", "userId": "uuid", "createdAt": "…", "expiresAt": "…" }
  ]
}
```

Each account's dashboard lives in `data/boards/<account-id>.json` with the same
shape:

```json
{
  "version": 1,
  "settings": { "units": "metric", "defaultLocationId": "uuid-or-null" },
  "locations": [
    {
      "id": "uuid",
      "city": "Portland, OR",
      "region": "Oregon",
      "country": "United States",
      "timezone": "America/Los_Angeles",
      "profileKey": "geo:5746545",
      "geocoded": true,
      "latitude": 45.52,
      "longitude": -122.68,
      "createdAt": "…",
      "revision": 0,
      "reading": {
        "source": "live",
        "provider": "Open-Meteo",
        "current": {},
        "forecast": [],
        "sun": {},
        "revision": 0,
        "storedAt": "…"
      }
    }
  ]
}
```

Writes are atomic (temp file + rename) and serialized. Locations saved before
geocoding was available are upgraded to real coordinates on the next live fetch.
A board saved before accounts existed in `data/weather.json` is copied to the
first account at sign-up. Delete an account's board file to reset just that
dashboard; delete `data/users.json` to remove all accounts and sessions.

## Tests

```bash
npm test
```

- `test/live.test.js` — place search and labels, geocoding (including comma
  hints), WMO mapping, live reading parsing, provider HTTP failures, and the
  sample fallback when the network is blocked. Uses a fake `fetch`; no network
  is required.
- `test/generator.test.js` — determinism, forecast shape, inverted southern
  seasons, polar night, nighttime UV, coordinate resolution and unit conversion.
- `test/api.test.js` — the real server on a temporary data file with live mode
  off, signed in first: add/duplicate/delete, picked-place coordinates,
  same-named places in different regions, default switching, refresh revisions,
  unit conversion, invalid JSON and static-file traversal protection.
- `test/auth.test.js` — sign-up validation, duplicate emails, sign-in, session
  cookies, signed-out redirects and 401s, per-account city isolation, sign-out,
  and the pre-account dashboard handoff.

## Deliberate limits

- Forecast is 5 days; no hourly forecast strip, alerts or history charts.
- Accounts have no email verification, password reset or social sign-in, and
  there is no login rate limiting. Use a reverse proxy with throttling before
  exposing the app publicly.
- Live mode needs outbound HTTPS access to `api.open-meteo.com` and
  `geocoding-api.open-meteo.com`. Offline mode (`WEATHER_SOURCE=local`) needs none.
- Open-Meteo's free tier has usage limits; readings are cached for 10 minutes to
  stay well inside them.
- The offline generator produces plausible synthetic weather, not a forecast.
