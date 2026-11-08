/**
 * Local Sky — a zero-dependency HTTP server.
 * Serves the static dashboard from /public and the JSON API from /api.
 */

import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readSessionToken } from './auth/cookies.js';
import { AccountStore } from './auth/accounts.js';
import { BoardStore } from './db/boards.js';
import { JsonStore } from './db/store.js';
import { handleApi } from './routes/api.js';
import { handleAuth } from './routes/auth.js';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(req, res, pathname, publicDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  if (relative === '/' || relative === '') relative = '/index.html';

  const target = path.resolve(publicDir, `.${relative}`);
  if (target !== publicDir && !target.startsWith(`${publicDir}${path.sep}`)) return false;

  try {
    const body = await readFile(target);
    const extension = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=120',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(body);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

/**
 * Builds a fully initialised HTTP server. Exported so tests can run it on an
 * ephemeral port with their own data file.
 */
export async function createServer(options = {}) {
  const dataFile = path.resolve(
    options.dataFile ?? process.env.DATA_FILE ?? path.join(PROJECT_ROOT, 'data', 'weather.json'),
  );
  const publicDir = path.resolve(options.publicDir ?? path.join(PROJECT_ROOT, 'public'));
  const quiet = options.quiet ?? false;
  const live = options.live ?? process.env.WEATHER_SOURCE !== 'local';

  const accountsFile = path.resolve(
    options.accountsFile ?? path.join(path.dirname(dataFile), 'users.json'),
  );
  const store = await new JsonStore(dataFile).init();
  const accounts = await new AccountStore(accountsFile).init();
  const boards = new BoardStore({
    directory: path.join(path.dirname(accountsFile), 'boards'),
    legacyStore: store,
  });

  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();

    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const session = await accounts.findSession(readSessionToken(req));

      if (await handleAuth(req, res, { url, accounts, boards, session })) {
        if (!quiet) logRequest(req, url, res.statusCode, startedAt);
        return;
      }

      if (
        (url.pathname === '/signin' || url.pathname === '/signup') &&
        (req.method === 'GET' || req.method === 'HEAD')
      ) {
        if (!(await serveStatic(req, res, '/auth.html', publicDir))) {
          sendJson(res, 500, {
            error: { code: 'missing_auth_page', message: 'The sign-in page is missing.' },
          });
        }
        if (!quiet) logRequest(req, url, res.statusCode, startedAt);
        return;
      }

      if ((url.pathname === '/' || url.pathname === '/index.html') && !session) {
        sendRedirect(res, '/signin?next=%2F');
        if (!quiet) logRequest(req, url, res.statusCode, startedAt);
        return;
      }

      const userStore = session ? await boards.get(session.user.id) : null;
      if (await handleApi(req, res, { url, store: userStore, user: session?.user ?? null, live })) {
        if (!quiet) logRequest(req, url, res.statusCode, startedAt);
        return;
      }

      if (await serveStatic(req, res, url.pathname, publicDir)) {
        if (!quiet) logRequest(req, url, res.statusCode, startedAt);
        return;
      }

      sendJson(res, 404, {
        error: { code: 'not_found', message: `Nothing lives at ${url.pathname}.` },
      });
      if (!quiet) logRequest(req, url, 404, startedAt);
    } catch (error) {
      console.error('[server]', error);
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: { code: 'internal_error', message: 'Something went wrong on the server.' },
        });
      } else {
        res.end();
      }
    }
  });

  server.dataFile = dataFile;
  server.store = store;
  server.accounts = accounts;
  server.boards = boards;
  server.live = live;
  return server;
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    location,
    'cache-control': 'no-store',
    'content-length': 0,
  });
  res.end();
}

function safeNext(value) {
  if (typeof value !== 'string') return null;
  if (
    value.length > 500 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return null;
  }
  return value;
}

function logRequest(req, url, status, startedAt) {
  const duration = Date.now() - startedAt;
  console.log(`${req.method} ${url.pathname}${url.search} → ${status} (${duration}ms)`);
}

export async function startServer() {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  const server = await createServer();

  server.listen(port, host, () => {
    console.log('');
    console.log('  Local Sky — live weather with a local fallback');
    console.log(`  http://localhost:${port}`);
    console.log(`  live: ${server.live ? 'on (Open-Meteo, no key)' : 'off — sample data only'}`);
    console.log(`  data: ${server.dataFile}`);
    console.log('');
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  startServer().catch((error) => {
    console.error('Failed to start Local Sky:', error);
    process.exit(1);
  });
}
