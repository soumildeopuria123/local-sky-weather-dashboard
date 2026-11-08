# Deployment

## Local

```bash
npm start
```

The server listens on `PORT` (default `3000`) and writes runtime state under
`data/`. Use `WEATHER_SOURCE=local` to run entirely offline.

## Cloudflare Worker / D1

Build the Worker bundle and static assets:

```bash
npm run build:worker
```

`dist/worker.js` is the bundle and `dist/public/` contains the static assets.
The hosted Worker needs a D1 binding named `DB`. Database schema setup is
handled by the Worker's storage layer on first use.

For a local Worker check:

```bash
npx wrangler@4 dev --ip 127.0.0.1 --port 8787
```

For Freebuff Sites, deploy using `sites.manifest.json` in the project root after
building. Keep production data, `.env` files and deploy credentials out of the
repository.
