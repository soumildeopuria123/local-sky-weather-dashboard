# Testing

Run the complete suite with:

```bash
npm test
```

The suite uses Node's built-in test runner and temporary data directories.

- `test/live.test.js` — geocoding, WMO mapping, live-reading parsing and provider failures.
- `test/generator.test.js` — deterministic fallback weather, seasons, polar night and units.
- `test/api.test.js` — location CRUD, picked-place coordinates, defaults, refresh and static-file safety.
- `test/auth.test.js` — sign-up validation, sign-in, session isolation, sign-out and the sign-in page.

Before publishing a Worker build, also run:

```bash
npm run build:worker
```
