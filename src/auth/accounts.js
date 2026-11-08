/**
 * Accounts and sessions, stored in a small JSON file next to the dashboard.
 *
 * Passwords are hashed with scrypt and a per-user random salt. Session tokens
 * are random, stored only as SHA-256 hashes, and expire after 30 days.
 */

import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { ValidationError } from '../db/locations.js';

const scrypt = promisify(scryptCallback);

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const KEY_LENGTH = 64;
const DUMMY_SALT = 'local-sky-dummy-salt';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function defaultState() {
  return { version: 1, users: [], sessions: [] };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function normalizeState(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;

  const emails = new Set();
  for (const user of Array.isArray(raw.users) ? raw.users : []) {
    if (!user || typeof user !== 'object') continue;
    if (typeof user.id !== 'string' || typeof user.email !== 'string') continue;
    if (typeof user.passwordHash !== 'string' || typeof user.salt !== 'string') continue;

    const email = user.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || emails.has(email)) continue;
    emails.add(email);

    state.users.push({
      id: user.id,
      name:
        typeof user.name === 'string' && user.name.trim()
          ? user.name.trim().slice(0, 60)
          : 'Explorer',
      email,
      passwordHash: user.passwordHash,
      salt: user.salt,
      createdAt:
        typeof user.createdAt === 'string' ? user.createdAt : new Date().toISOString(),
    });
  }

  const userIds = new Set(state.users.map((user) => user.id));
  for (const session of Array.isArray(raw.sessions) ? raw.sessions : []) {
    if (!session || typeof session !== 'object') continue;
    if (typeof session.tokenHash !== 'string' || typeof session.userId !== 'string') continue;
    if (!userIds.has(session.userId)) continue;
    if (!Number.isFinite(Date.parse(session.expiresAt ?? ''))) continue;

    state.sessions.push({
      tokenHash: session.tokenHash,
      userId: session.userId,
      createdAt:
        typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
      expiresAt: session.expiresAt,
    });
  }

  return state;
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

export class AccountStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = defaultState();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.state = normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(
          `[accounts] Could not read ${this.filePath} (${error.message}). Starting with no accounts.`,
        );
        await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => {});
      }
      this.state = defaultState();
    }

    this.pruneSessions(this.state);
    await this.persist();
    return this;
  }

  getUserCount() {
    return this.state.users.length;
  }

  getUserById(id) {
    const user = this.state.users.find((entry) => entry.id === id);
    return user ? publicUser(user) : null;
  }

  async signUp({ name, email, password }) {
    const clean = {
      name: cleanName(name),
      email: cleanEmail(email),
      password: cleanPassword(password),
    };

    const salt = randomBytes(16).toString('hex');
    const hash = await scrypt(clean.password, salt, KEY_LENGTH);

    return this.update((state) => {
      if (state.users.some((user) => user.email === clean.email)) {
        throw new ValidationError(
          'An account with that email already exists. Try signing in instead.',
          'email_taken',
          409,
        );
      }

      const user = {
        id: randomUUID(),
        name: clean.name,
        email: clean.email,
        passwordHash: hash.toString('hex'),
        salt,
        createdAt: new Date().toISOString(),
      };
      state.users.push(user);
      return publicUser(user);
    });
  }

  async authenticate(email, password) {
    const address = String(email ?? '')
      .trim()
      .toLowerCase();
    const candidatePassword = typeof password === 'string' ? password.slice(0, 200) : '';
    const user = this.state.users.find((entry) => entry.email === address);

    // Always run scrypt once so a missing account is not obviously faster.
    const salt = user?.salt ?? DUMMY_SALT;
    const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(KEY_LENGTH);
    const actual = await scrypt(candidatePassword, salt, KEY_LENGTH);
    const matches =
      actual.length === expected.length && timingSafeEqual(actual, expected);

    return matches && user ? publicUser(user) : null;
  }

  async createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();

    await this.update((state) => {
      this.pruneSessions(state, now);
      state.sessions.push({
        tokenHash: hashToken(token),
        userId,
        createdAt: new Date(now).toISOString(),
        expiresAt,
      });
    });

    return { token, expiresAt };
  }

  findSession(token) {
    if (typeof token !== 'string' || token.length < 20) return null;

    const tokenHash = hashToken(token);
    const session = this.state.sessions.find((entry) => entry.tokenHash === tokenHash);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;

    const user = this.state.users.find((entry) => entry.id === session.userId);
    if (!user) return null;

    return { user: publicUser(user), token, expiresAt: session.expiresAt };
  }

  async destroySession(token) {
    if (typeof token !== 'string' || !token) return false;

    const tokenHash = hashToken(token);
    return this.update((state) => {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((entry) => entry.tokenHash !== tokenHash);
      return state.sessions.length !== before;
    });
  }

  pruneSessions(state, now = Date.now()) {
    state.sessions = state.sessions.filter((session) => Date.parse(session.expiresAt) > now);
  }

  update(mutator) {
    const run = this.writeQueue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = normalizeState(draft);
      await this.persist();
      return result;
    });

    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  async persist() {
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, payload, 'utf8');
    await rename(temporary, this.filePath);
  }
}
