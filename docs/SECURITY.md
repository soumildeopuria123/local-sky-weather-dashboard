# Security notes

- Passwords are hashed with a random per-user salt: scrypt locally and
  PBKDF2-SHA256 in the Worker.
- Sessions are random server-side tokens stored as hashes. The browser receives
  an `HttpOnly`, `SameSite=Lax` cookie, marked `Secure` over HTTPS.
- Every dashboard route is scoped to the signed-in account.
- Runtime data belongs under `data/` and is excluded from Git. Never commit a
  local `.env`, D1 export, session cookie, password or deploy key.
- There is no email verification, password reset or built-in login rate
  limiting. Put the app behind a throttling reverse proxy before exposing it to
  untrusted traffic.
- The hosted app uses a D1 binding named `DB`; secrets belong in the hosting
  provider's secret store, never in the repository.
