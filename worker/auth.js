/**
 * Accounts and sessions for the hosted Worker.
 *
 * Passwords use PBKDF2-SHA-256 through Web Crypto (Workers have no scrypt).
 * Session tokens are random, stored as SHA-256 hashes in D1, and expire after
 * 30 days.
 */

import { ValidationError } from '../src/db/locations.js';

export const SESSION_COOKIE = 'localsky_session';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 100_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const encoder = new TextEncoder();

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    iterations INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS boards (
    user_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

const schemaReady = new WeakMap();

export async function ensureSchema(db) {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db
      .batch(SCHEMA.map((sql) => db.prepare(sql)))
      .then(() => undefined)
      .catch((error) => {
        schemaReady.delete(db);
        throw error;
      });
    schemaReady.set(db, ready);
  }
  return ready;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hashPassword(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex),
      iterations,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at ?? row.createdAt,
  };
}

function cleanName(value) {
  const name = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (name.length < 2) {
    throw new ValidationError('Enter your name (at least 2 characters).', 'name_invalid', 400);
  }
  if (name.length > 60) {
    throw new ValidationError('Names must be 60 characters or fewer.', 'name_too_long', 400);
  }
  if (/[\u0000-\u001f]/.test(name)) {
    throw new ValidationError('That name contains invalid characters.', 'name_invalid', 400);
  }
  return name;
}

function cleanEmail(value) {
  const email = String(value ?? '')
    .trim()
    .toLowerCase();

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError('Enter a valid email address.', 'email_invalid', 400);
  }
  return email;
}

function cleanPassword(value) {
  if (typeof value !== 'string' || value.length < 8) {
    throw new ValidationError(
      'Use at least 8 characters for your password.',
      'password_too_short',
      400,
    );
  }
  if (value.length > 200) {
    throw new ValidationError('Passwords must be 200 characters or fewer.', 'password_too_long', 400);
  }
  return value;
}

export async function signUp(db, { name, email, password }) {
  const clean = {
    name: cleanName(name),
    email: cleanEmail(email),
    password: cleanPassword(password),
  };

  const salt = bytesToHex(randomBytes(16));
  const passwordHash = await hashPassword(clean.password, salt, PASSWORD_ITERATIONS);
  const user = {
    id: crypto.randomUUID(),
    name: clean.name,
    email: clean.email,
    createdAt: new Date().toISOString(),
  };

  try {
    await db
      .prepare(
        `INSERT INTO users (id, name, email, password_hash, salt, iterations, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        user.id,
        user.name,
        user.email,
        passwordHash,
        salt,
        PASSWORD_ITERATIONS,
        user.createdAt,
      )
      .run();
  } catch (error) {
    if (String(error?.message ?? '').toLowerCase().includes('unique')) {
      throw new ValidationError(
        'An account with that email already exists. Try signing in instead.',
        'email_taken',
        409,
      );
    }
    throw error;
  }

  return user;
}

export async function signIn(db, { email, password }) {
  const address = String(email ?? '')
    .trim()
    .toLowerCase();
  const candidate = typeof password === 'string' ? password.slice(0, 200) : '';

  const row = await db
    .prepare(
      `SELECT id, name, email, password_hash, salt, iterations, created_at
       FROM users WHERE email = ?`,
    )
    .bind(address)
    .first();

  const salt = row?.salt ?? '00000000000000000000000000000000';
  const iterations = row?.iterations ?? PASSWORD_ITERATIONS;
  const candidateHash = await hashPassword(candidate, salt, iterations);

  if (!row || !safeEqual(candidateHash, row.password_hash)) return null;
  return publicUser(row);
}

export async function createSession(db, userId) {
  const token = toBase64Url(randomBytes(32));
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(
      await sha256Hex(token),
      userId,
      new Date(now).toISOString(),
      new Date(now + SESSION_TTL_MS).toISOString(),
    )
    .run();

  return token;
}

export async function findSession(db, token) {
  if (typeof token !== 'string' || token.length < 20) return null;

  const row = await db
    .prepare(
      `SELECT s.expires_at, u.id, u.name, u.email, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first();

  if (!row) return null;
  return { user: publicUser(row), token };
}

export async function destroySession(db, token) {
  if (!token) return;
  await db
    .prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .run();
}

export async function pruneSessions(db) {
  await db
    .prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .bind(new Date().toISOString())
    .run();
}

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

export function readSessionToken(request) {
  return parseCookies(request.headers.get('cookie') ?? '')[SESSION_COOKIE] ?? null;
}

export function sessionCookie(token, secure) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
