import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { createServer } from '../src/server.js';

let server;
let baseUrl;
let directory;
let adaCookie;

function cookieFrom(response) {
  const raw = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '';
  assert.ok(raw, 'expected a session cookie');
  return raw.split(';')[0];
}

async function request(pathname, { method = 'GET', cookie, payload, redirect = 'follow' } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    redirect,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body =
    response.status === 204 || response.headers.get('content-type')?.includes('text/html')
      ? null
      : await response.json().catch(() => null);
  return { response, body };
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'local-sky-auth-'));
  server = await createServer({
    dataFile: path.join(directory, 'weather.json'),
    quiet: true,
    live: false,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test('signing up creates an account, a session and a private dashboard', async () => {
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    payload: {
      name: 'Ada Lovelace',
      email: 'ADA@example.com',
      password: 'analytical-engine',
    },
  });

  assert.equal(signup.response.status, 201);
  assert.equal(signup.body.user.name, 'Ada Lovelace');
  assert.equal(signup.body.inherited, false);
  assert.equal(signup.body.user.email, 'ada@example.com');
  assert.equal(signup.body.user.passwordHash, undefined);
  assert.match(signup.response.headers.getSetCookie()[0], /HttpOnly/);
  assert.match(signup.response.headers.getSetCookie()[0], /SameSite=Lax/);

  adaCookie = cookieFrom(signup.response);

  const me = await request('/api/auth/me', { cookie: adaCookie });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.name, 'Ada Lovelace');

  const dashboard = await request('/api/locations', { cookie: adaCookie });
  assert.equal(dashboard.response.status, 200);
  assert.deepEqual(dashboard.body.locations, []);
});

test('duplicate emails, weak passwords and bad emails are rejected', async () => {
  const duplicate = await request('/api/auth/signup', {
    method: 'POST',
    payload: {
      name: 'Someone Else',
      email: 'ada@example.com',
      password: 'another-password',
    },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'email_taken');

  const weak = await request('/api/auth/signup', {
    method: 'POST',
    payload: { name: 'Short Pass', email: 'short@example.com', password: 'short' },
  });
  assert.equal(weak.response.status, 400);
  assert.equal(weak.body.error.code, 'password_too_short');

  const badEmail = await request('/api/auth/signup', {
    method: 'POST',
    payload: { name: 'No Address', email: 'not-an-email', password: 'long-enough-pass' },
  });
  assert.equal(badEmail.response.status, 400);
  assert.equal(badEmail.body.error.code, 'email_invalid');
});

test('signed-out visitors are sent to the sign-in page, and APIs are closed', async () => {
  const home = await request('/', { redirect: 'manual' });
  assert.equal(home.response.status, 302);
  assert.equal(home.response.headers.get('location'), '/signin?next=%2F');

  const authPage = await request('/signin');
  assert.equal(authPage.response.status, 200);
  assert.match(authPage.response.headers.get('content-type'), /text\/html/);
  const html = await authPage.response.text();
  assert.match(html, /Welcome back/);

  const weather = await request('/api/weather');
  assert.equal(weather.response.status, 401);
  assert.equal(weather.body.error.code, 'auth_required');

  const geocode = await request('/api/geocode?q=paris');
  assert.equal(geocode.response.status, 401);
});

test('signing in requires the right password and issues a fresh session', async () => {
  const wrong = await request('/api/auth/signin', {
    method: 'POST',
    payload: { email: 'ada@example.com', password: 'wrong-password' },
  });
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.body.error.code, 'invalid_credentials');

  const right = await request('/api/auth/signin', {
    method: 'POST',
    payload: { email: 'ada@example.com', password: 'analytical-engine' },
  });
  assert.equal(right.response.status, 200);
  assert.equal(right.body.user.name, 'Ada Lovelace');

  const freshCookie = cookieFrom(right.response);
  const me = await request('/api/auth/me', { cookie: freshCookie });
  assert.equal(me.response.status, 200);
});

test('each account keeps its own cities', async () => {
  const added = await request('/api/locations', {
    method: 'POST',
    cookie: adaCookie,
    payload: {
      city: 'Portland',
      place: {
        id: 5746545,
        name: 'Portland',
        region: 'Oregon',
        country: 'United States',
        latitude: 45.5234,
        longitude: -122.6762,
        timezone: 'America/Los_Angeles',
      },
    },
  });
  assert.equal(added.response.status, 201);

  const bob = await request('/api/auth/signup', {
    method: 'POST',
    payload: {
      name: 'Bob Builder',
      email: 'bob@example.com',
      password: 'can-we-fix-it',
    },
  });
  assert.equal(bob.response.status, 201);
  const bobCookie = cookieFrom(bob.response);

  const bobBoard = await request('/api/locations', { cookie: bobCookie });
  assert.equal(bobBoard.response.status, 200);
  assert.deepEqual(bobBoard.body.locations, []);

  const adaBoard = await request('/api/locations', { cookie: adaCookie });
  assert.equal(adaBoard.body.locations.length, 1);
  assert.equal(adaBoard.body.locations[0].city, 'Portland');

  const bobWeather = await request('/api/weather', { cookie: bobCookie });
  assert.deepEqual(bobWeather.body.locations, []);

  const adaWeather = await request('/api/weather', { cookie: adaCookie });
  assert.equal(adaWeather.body.locations.length, 1);
});

test('signing out clears the cookie and ends the session', async () => {
  const bob = await request('/api/auth/signin', {
    method: 'POST',
    payload: { email: 'bob@example.com', password: 'can-we-fix-it' },
  });
  const bobCookie = cookieFrom(bob.response);

  const signout = await request('/api/auth/signout', {
    method: 'POST',
    cookie: bobCookie,
  });
  assert.equal(signout.response.status, 204);
  assert.match(signout.response.headers.getSetCookie()[0], /Max-Age=0/);

  const me = await request('/api/auth/me', { cookie: bobCookie });
  assert.equal(me.response.status, 401);
});

test('the first account inherits cities saved before accounts existed', async () => {
  const legacyDirectory = await mkdtemp(path.join(tmpdir(), 'local-sky-legacy-'));
  const legacyFile = path.join(legacyDirectory, 'weather.json');

  await writeFile(
    legacyFile,
    JSON.stringify({
      version: 1,
      settings: { units: 'metric', defaultLocationId: 'legacy-city' },
      locations: [
        {
          id: 'legacy-city',
          city: 'Legacy Town',
          region: null,
          country: null,
          timezone: null,
          profileKey: null,
          geocoded: false,
          latitude: 12.5,
          longitude: 34.5,
          createdAt: new Date().toISOString(),
          revision: 0,
          reading: null,
        },
      ],
    }),
  );

  const legacyServer = await createServer({
    dataFile: legacyFile,
    quiet: true,
    live: false,
  });
  await new Promise((resolve) => legacyServer.listen(0, '127.0.0.1', resolve));
  const legacyBaseUrl = `http://127.0.0.1:${legacyServer.address().port}`;

  try {
    const signup = await fetch(`${legacyBaseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'First Owner',
        email: 'first@example.com',
        password: 'inherits-the-cities',
      }),
    });
    assert.equal(signup.status, 201);
    const signupBody = await signup.json();
    assert.equal(signupBody.inherited, true);
    const cookie = cookieFrom(signup);

    const list = await fetch(`${legacyBaseUrl}/api/locations`, { headers: { cookie } });
    const body = await list.json();
    assert.equal(body.locations.length, 1);
    assert.equal(body.locations[0].city, 'Legacy Town');
  } finally {
    await new Promise((resolve) => legacyServer.close(resolve));
    await rm(legacyDirectory, { recursive: true, force: true });
  }
});

test('the sign-in page stays available for signed-in visitors', async () => {
  const signin = await request('/api/auth/signin', {
    method: 'POST',
    payload: { email: 'ada@example.com', password: 'analytical-engine' },
  });
  assert.equal(signin.response.status, 200);

  const page = await request('/signin', { cookie: cookieFrom(signin.response) });
  assert.equal(page.response.status, 200);
  assert.match(page.response.headers.get('content-type'), /text\/html/);
  assert.match(await page.response.text(), /id="signin-form"/);
});
