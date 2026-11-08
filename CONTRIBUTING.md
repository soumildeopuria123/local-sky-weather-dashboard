# Contributing

Thanks for improving Local Sky.

## Setup

Requires Node.js 20 or newer. The local app has no runtime dependencies.

```bash
npm start
npm test
```

Open <http://localhost:3000>, create an account, and search for a city.

## Ground rules

- Keep the frontend dependency-free: vanilla HTML, CSS and JavaScript.
- Keep API access on this project's own routes; do not call third-party weather APIs from the browser.
- Never commit `data/`, `.env`, deploy keys, logs or generated build output.
- Add or update tests when behavior changes.
- Run `npm test` and `npm run build:worker` before opening a pull request.

## Pull requests

Describe the user-visible change, the reason for it, and the checks you ran. Keep unrelated changes out of the same pull request.
