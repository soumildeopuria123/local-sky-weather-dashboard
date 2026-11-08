/** Account API: sign up, sign in, sign out, and the current session. */

import {
  isSecureRequest,
  readSessionToken,
  serializeSessionCookie,
} from '../auth/cookies.js';
import { SESSION_TTL_MS } from '../auth/accounts.js';
import { ValidationError } from '../db/locations.js';
import { readJsonBody } from './body.js';

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function fail(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function startSession(req, res, token) {
  res.setHeader(
    'set-cookie',
    serializeSessionCookie(token, {
      maxAgeSeconds: SESSION_TTL_MS / 1000,
      secure: isSecureRequest(req),
    }),
  );
}

function endSession(req, res) {
  res.setHeader(
    'set-cookie',
    serializeSessionCookie('', { maxAgeSeconds: 0, secure: isSecureRequest(req) }),
  );
}

/**
 * @returns {Promise<boolean>} true when the request was an auth API route.
 */
export async function handleAuth(req, res, { url, accounts, boards, session }) {
  if (!url.pathname.startsWith('/api/auth/')) return false;

  const method = req.method ?? 'GET';

  try {
    if (url.pathname === '/api/auth/signup' && method === 'POST') {
      const body = await readJsonBody(req);
      const user = await accounts.signUp({
        name: body.name,
        email: body.email,
        password: body.password,
      });

      let inherited = false;
      if (accounts.getUserCount() === 1) {
        inherited = await boards.seedFromLegacy(user.id);
      }

      const { token } = await accounts.createSession(user.id);
      startSession(req, res, token);
      sendJson(res, 201, { user, inherited });
      return true;
    }

    if (url.pathname === '/api/auth/signin' && method === 'POST') {
      const body = await readJsonBody(req);
      const user = await accounts.authenticate(body.email, body.password);
      if (!user) {
        fail(res, 401, 'invalid_credentials', 'Email or password is incorrect.');
        return true;
      }

      const { token } = await accounts.createSession(user.id);
      startSession(req, res, token);
      sendJson(res, 200, { user });
      return true;
    }

    if (url.pathname === '/api/auth/signout' && method === 'POST') {
      const token = session?.token ?? readSessionToken(req);
      if (token) await accounts.destroySession(token);
      endSession(req, res);
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return true;
    }

    if (url.pathname === '/api/auth/me' && method === 'GET') {
      if (!session) {
        fail(res, 401, 'auth_required', 'Sign in to see your weather dashboard.');
        return true;
      }
      sendJson(res, 200, { user: session.user });
      return true;
    }

    sendJson(res, 404, {
      error: { code: 'not_found', message: `No auth route for ${method} ${url.pathname}.` },
    });
    return true;
  } catch (error) {
    if (error instanceof ValidationError) {
      fail(res, error.status ?? 400, error.code ?? 'invalid_request', error.message);
      return true;
    }

    console.error('[auth]', error);
    fail(res, 500, 'internal_error', 'Something went wrong on the server.');
    return true;
  }
}
