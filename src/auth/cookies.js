/** Cookie helpers for the signed-in session. No dependencies. */

export const SESSION_COOKIE = 'localsky_session';

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const name = part.slice(0, separator).trim();
    if (!name) continue;

    let value = part.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function readSessionToken(req) {
  return parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE] ?? null;
}

export function isSecureRequest(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwarded === 'https' || Boolean(req.socket?.encrypted);
}

export function serializeSessionCookie(token, { maxAgeSeconds = 0, secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
