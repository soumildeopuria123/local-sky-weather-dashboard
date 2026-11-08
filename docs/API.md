# API

All routes except `/api/health` and `/api/auth/*` require the signed-in session
cookie. Errors use `{ "error": { "code": "...", "message": "..." } }`.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/auth/signup` | Create an account and session |
| POST | `/api/auth/signin` | Sign in with email and password |
| POST | `/api/auth/signout` | End the current session |
| GET | `/api/auth/me` | Current account |
| GET | `/api/health` | Liveness and live/offline mode |
| GET | `/api/geocode?q=tokyo` | Matching places with coordinates |
| GET | `/api/locations` | Saved places and settings |
| POST | `/api/locations` | Add a place |
| PATCH | `/api/locations/:id` | Change default status |
| DELETE | `/api/locations/:id` | Remove a place |
| GET | `/api/weather` | All saved places with current weather |
| GET | `/api/weather/:id` | One saved place |
| POST | `/api/weather/refresh` | Force a fresh live fetch |
| PUT | `/api/settings` | Update units or default place |

`GET /api/weather?units=imperial` converts the response without changing the
saved unit preference.
