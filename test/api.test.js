import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { createServer } from '../src/server.js';

let server;
let baseUrl;
let directory;
let cookie;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'local-sky-'));
  server = await createServer({
    dataFile: path.join(directory, 'weather.json'),
    quiet: true,
    live: false,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const signup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'API Tester',
      email: 'api-tester@example.com',
      password: 'correct-horse-battery',
    }),
  });
  assert.equal(signup.status, 201);
  const setCookie = signup.headers.getSetCookie?.()[0] ?? signup.headers.get('set-cookie');
  cookie = setCookie.split(';')[0];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { cookie } });
  return { response, body: await response.json() };
}

async function postJson(pathname, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(payload),
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

test('health check reports the local engine', async () => {
  const { response, body } = await getJson('/api/health');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.engine, 'local-generator');
});

test('empty dashboard returns no locations and metric defaults', async () => {
  const { response, body } = await getJson('/api/weather');
  assert.equal(response.status, 200);
  assert.deepEqual(body.locations, []);
  assert.equal(body.units, 'metric');
  assert.equal(body.settings.units, 'metric');
});

test('adding a city generates weather immediately and makes it the default', async () => {
  const { response, body } = await postJson('/api/locations', { city: 'Portland, OR' });
  assert.equal(response.status, 201);
  assert.equal(body.location.city, 'Portland, OR');
  assert.equal(body.location.region, 'Oregon');
  assert.equal(body.location.isDefault, true);
  assert.equal(body.location.forecast.length, 5);
  assert.equal(body.location.source, 'sample');
  assert.ok(body.location.current.humidity >= 20);
  assert.ok(body.location.current.cloudCover >= 0);
  assert.ok(body.location.current.gusts >= 0);

  const list = await getJson('/api/weather');
  assert.equal(list.body.locations.length, 1);
  assert.equal(list.body.locations[0].city, 'Portland, OR');
});

test('duplicate and blank cities are rejected with friendly errors', async () => {
  const duplicate = await postJson('/api/locations', { city: 'portland' });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'duplicate_location');

  const blank = await postJson('/api/locations', { city: '   ' });
  assert.equal(blank.response.status, 400);
  assert.equal(blank.body.error.code, 'city_required');
});

test('imperial units convert the same cached reading', async () => {
  const metric = await getJson('/api/weather?units=metric');
  const metricTemperature = metric.body.locations[0].current.temperature;

  const settings = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ units: 'imperial' }),
  });
  assert.equal(settings.status, 200);

  const imperial = await getJson('/api/weather');
  assert.equal(imperial.body.units, 'imperial');
  assert.equal(imperial.body.locations[0].unitLabels.temperature, '°F');
  assert.equal(
    imperial.body.locations[0].current.temperature,
    Math.round(((metricTemperature * 9) / 5 + 32) * 10) / 10,
  );

  await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ units: 'metric' }),
  });
});

test('refresh regenerates readings and bumps the revision', async () => {
  const beforeRefresh = await getJson('/api/weather');
  const previousRevision = beforeRefresh.body.locations[0].revision;

  const refreshed = await postJson('/api/weather/refresh', {});
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.locations[0].revision, previousRevision + 1);
  assert.equal(refreshed.body.locations[0].forecast.length, 5);
});

test('default city can be switched and is served first', async () => {
  const added = await postJson('/api/locations', { city: 'Tokyo' });
  assert.equal(added.response.status, 201);
  assert.equal(added.body.location.isDefault, false);

  const patched = await fetch(`${baseUrl}/api/locations/${added.body.location.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ isDefault: true }),
  });
  assert.equal(patched.status, 200);

  const list = await getJson('/api/weather');
  assert.equal(list.body.locations[0].city, 'Tokyo');
  assert.equal(list.body.locations[0].isDefault, true);
});

test('deleting a location removes it from the dashboard', async () => {
  const list = await getJson('/api/locations');
  const target = list.body.locations.find((location) => location.city === 'Tokyo');

  const deleted = await fetch(`${baseUrl}/api/locations/${target.id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(deleted.status, 204);

  const afterDelete = await getJson('/api/weather');
  assert.equal(afterDelete.body.locations.length, 1);
  assert.equal(afterDelete.body.locations[0].city, 'Portland, OR');

  const missing = await fetch(`${baseUrl}/api/locations/${target.id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(missing.status, 404);
});

const SPRINGFIELD_ILLINOIS = {
  id: 4250542,
  name: 'Springfield',
  region: 'Illinois',
  country: 'United States',
  latitude: 39.7817,
  longitude: -89.6501,
  timezone: 'America/Chicago',
  label: 'Springfield, Illinois, United States',
};

test('place search explains that it needs live mode', async () => {
  const { response, body } = await getJson('/api/geocode?q=paris');
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'live_required');
});

test('a picked place keeps its exact coordinates and allows same-named places', async () => {
  const added = await postJson('/api/locations', {
    city: 'Springfield',
    place: SPRINGFIELD_ILLINOIS,
  });
  assert.equal(added.response.status, 201);
  assert.equal(added.body.location.city, 'Springfield');
  assert.equal(added.body.location.region, 'Illinois');
  assert.equal(added.body.location.country, 'United States');
  assert.equal(added.body.location.latitude, 39.7817);
  assert.equal(added.body.location.longitude, -89.6501);
  assert.equal(added.body.location.source, 'sample');

  const duplicate = await postJson('/api/locations', {
    city: 'Springfield',
    place: SPRINGFIELD_ILLINOIS,
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'duplicate_location');

  const missouri = await postJson('/api/locations', {
    city: 'Springfield',
    place: {
      ...SPRINGFIELD_ILLINOIS,
      id: 4409896,
      region: 'Missouri',
      latitude: 37.2089,
      longitude: -93.2923,
    },
  });
  assert.equal(missouri.response.status, 201);
  assert.equal(missouri.body.location.region, 'Missouri');
});

test('a picked place with invalid coordinates is rejected', async () => {
  const { response, body } = await postJson('/api/locations', {
    city: 'Nowhere',
    place: { name: 'Nowhere', latitude: 999, longitude: 0 },
  });
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'place_invalid');
});

test('invalid JSON is rejected cleanly', async () => {
  const response = await fetch(`${baseUrl}/api/locations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: '{not json',
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'invalid_json');
});

test('static dashboard is served and traversal is blocked', async () => {
  const index = await fetch(`${baseUrl}/`, { headers: { cookie } });
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const html = await index.text();
  assert.match(html, /Local Sky/);
  assert.match(html, /id="welcome-name"/);
  assert.match(html, /id="empty-cta"/);

  const traversal = await fetch(`${baseUrl}/..%2fpackage.json`, { headers: { cookie } });
  assert.equal(traversal.status, 404);
  assert.equal((await traversal.json()).error.code, 'not_found');
});
