/**
 * Local Sky on Cloudflare Workers.
 *
 * Serves the same static dashboard and JSON API as the local Node server, with
 * D1 for accounts, sessions and one dashboard per account.
 */

import {
  addLocation,
  findLocation,
  removeLocation,
  sanitizeCityInput,
  setDefaultLocation,
  updateSettings,
  ValidationError,
} from '../src/db/locations.js';
import { resolveProfile } from '../src/weather/generator.js';
import {
  CityNotFoundError,
  geocodeCity,
  LIVE_PROVIDER,
  LiveWeatherError,
  searchPlaces,
} from '../src/weather/live.js';
import { ensureReadings } from '../src/weather/service.js';
import { isUnitSystem, toDisplayUnits, unitLabels } from '../src/weather/units.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  ensureSchema,
  findSession,
  pruneSessions,
  readSessionToken,
  sessionCookie,
  signIn,
  signUp,
} from './auth.js';
import { openBoard } from './board.js';

const MAX_BODY_CHARS = 32 * 1024;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function empty(status, headers = {}) {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

function fail(status, code, message) {
  return json({ error: { code, message } }, status);
}

function redirect(location, status = 302) {
  return new Response(null, {
    status,
    headers: { location, 'cache-control': 'no-store' },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    throw new ValidationError('Request body is too large.', 'body_too_large', 413);
  }
  if (!text) return {};

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError('Request body must be valid JSON.', 'invalid_json', 400);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('Request body must be a JSON object.', 'invalid_body', 400);
  }
  return parsed;
}

function serveAsset(env, url, pathname, request) {
  const assetUrl = new URL(pathname, url);
  return env.ASSETS.fetch(
    new Request(assetUrl, {
      method: request.method,
      headers: request.headers,
    }),
  );
}

/* ----------------------------- serialisation ----------------------------- */

function resolveUnits(searchParams, settings) {
  const requested = searchParams.get('units');
  if (isUnitSystem(requested)) return requested;
  return isUnitSystem(settings.units) ? settings.units : 'metric';
}

function sortLocations(locations, settings) {
  return [...locations].sort((left, right) => {
    const leftDefault = left.id === settings.defaultLocationId ? 1 : 0;
    const rightDefault = right.id === settings.defaultLocationId ? 1 : 0;
    if (leftDefault !== rightDefault) return rightDefault - leftDefault;
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
}

function serializeLocation(location, state, units) {
  const display = toDisplayUnits(location.reading, units);
  return {
    id: location.id,
    city: location.city,
    region: location.region,
    country: location.country,
    timezone: location.timezone ?? null,
    latitude: location.latitude,
    longitude: location.longitude,
    isDefault: state.settings.defaultLocationId === location.id,
    revision: location.reading.revision,
    source: location.reading.source ?? 'sample',
    provider: location.reading.provider ?? 'local engine',
    observedAt: location.reading.observedAt ?? null,
    fallbackReason: location.reading.fallbackReason ?? null,
    updatedAt: location.reading.storedAt,
    ...display,
  };
}

function weatherPayload(state, units) {
  return {
    units,
    unitLabels: unitLabels(units),
    provider: LIVE_PROVIDER,
    settings: state.settings,
    locations: sortLocations(state.locations, state.settings).map((location) =>
      serializeLocation(location, state, units),
    ),
    generatedAt: new Date().toISOString(),
  };
}

function locationsPayload(state) {
  return {
    settings: state.settings,
    locations: sortLocations(state.locations, state.settings).map((location) => ({
      id: location.id,
      city: location.city,
      region: location.region,
      country: location.country,
      timezone: location.timezone ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
      createdAt: location.createdAt,
      isDefault: state.settings.defaultLocationId === location.id,
      updatedAt: location.reading?.storedAt ?? null,
      source: location.reading?.source ?? null,
    })),
  };
}

function readPlaceInput(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      'That place could not be read. Search again and pick a result.',
      'place_invalid',
      400,
    );
  }

  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new ValidationError(
      'That place has invalid coordinates. Search again and pick a result.',
      'place_invalid',
      400,
    );
  }

  const clean = (input, max) => {
    const text = String(input ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, max) : null;
  };
  const id = clean(value.id, 64)?.replace(/[^A-Za-z0-9:._-]/g, '');

  return {
    city: sanitizeCityInput(value.name),
    region: clean(value.region, 80),
    country: clean(value.country, 80),
    timezone: clean(value.timezone, 64),
    latitude: Math.round(latitude * 10000) / 10000,
    longitude: Math.round(longitude * 10000) / 10000,
    geocoded: true,
    profileKey: `geo:${id || `${latitude},${longitude}`}`,
  };
}

async function resolveCityProfile(city) {
  try {
    return await geocodeCity(city);
  } catch (error) {
    if (error instanceof CityNotFoundError) {
      throw new ValidationError(
        `We couldn't find "${city}". Try a nearby larger town, or add a region such as "Portland, USA".`,
        'city_not_found',
        404,
      );
    }
    return resolveProfile(city);
  }
}

/* --------------------------------- auth ---------------------------------- */

async function handleAuth(request, env, url, session) {
  const db = env.DB;
  const method = request.method ?? 'GET';
  const path = url.pathname;
  const secure = url.protocol === 'https:';

  if (path === '/api/auth/signup' && method === 'POST') {
    const body = await readJson(request);
    const user = await signUp(db, body);
    await pruneSessions(db);
    const token = await createSession(db, user.id);

    return json(
      { user, inherited: false },
      201,
      { 'set-cookie': sessionCookie(token, secure) },
    );
  }

  if (path === '/api/auth/signin' && method === 'POST') {
    const body = await readJson(request);
    const user = await signIn(db, body);
    if (!user) {
      return fail(401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    await pruneSessions(db);
    const token = await createSession(db, user.id);
    return json({ user }, 200, { 'set-cookie': sessionCookie(token, secure) });
  }

  if (path === '/api/auth/signout' && method === 'POST') {
    const token = session?.token ?? readSessionToken(request);
    if (token) await destroySession(db, token);
    return empty(204, { 'set-cookie': clearSessionCookie(secure) });
  }

  if (path === '/api/auth/me' && method === 'GET') {
    if (!session) {
      return fail(401, 'auth_required', 'Sign in to see your weather dashboard.');
    }
    return json({ user: session.user });
  }

  return json(
    { error: { code: 'not_found', message: `No auth route for ${method} ${path}.` } },
    404,
  );
}

/* ------------------------------- dashboard -------------------------------- */

async function handleApi(request, env, url, session) {
  const db = env.DB;
  const method = request.method ?? 'GET';
  const path = url.pathname;

  try {
    if (path === '/api/health' && method === 'GET') {
      return json({
        ok: true,
        engine: 'local-generator',
        provider: LIVE_PROVIDER,
        live: true,
        time: new Date().toISOString(),
      });
    }

    if (path.startsWith('/api/auth/')) {
      return await handleAuth(request, env, url, session);
    }

    if (!session) {
      return fail(401, 'auth_required', 'Sign in to open your weather dashboard.');
    }

    const board = await openBoard(db, session.user.id);

    if (path === '/api/geocode' && method === 'GET') {
      const query = String(url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim();
      if (query.length < 2) return json({ results: [] });
      if (query.length > 80) {
        throw new ValidationError(
          'Search text must be 80 characters or fewer.',
          'query_too_long',
          400,
        );
      }

      try {
        const results = await searchPlaces(query, { count: 10 });
        return json({ results });
      } catch (error) {
        if (error instanceof LiveWeatherError) {
          return fail(
            502,
            'geocode_unavailable',
            'Place search is unavailable right now. You can still type a place name and press Add.',
          );
        }
        throw error;
      }
    }

    if (path === '/api/locations' && method === 'GET') {
      return json(locationsPayload(board.getState()));
    }

    if (path === '/api/locations' && method === 'POST') {
      const body = await readJson(request);
      const chosen = readPlaceInput(body.place);
      const city = sanitizeCityInput(chosen?.city ?? body.city);
      const profile = chosen ?? (await resolveCityProfile(city));
      const location = await addLocation(board, { city, profile });

      await ensureReadings(board, { ids: [location.id], live: true });

      const state = board.getState();
      const saved = findLocation(state, location.id);
      return json(
        {
          location: serializeLocation(
            saved,
            state,
            resolveUnits(url.searchParams, state.settings),
          ),
        },
        201,
      );
    }

    const locationMatch = path.match(/^\/api\/locations\/([^/]+)$/);
    if (locationMatch) {
      const id = decodeURIComponent(locationMatch[1]);

      if (method === 'DELETE') {
        await removeLocation(board, id);
        return empty(204);
      }

      if (method === 'PATCH') {
        const body = await readJson(request);
        if (body.isDefault !== true) {
          throw new ValidationError(
            'Only {"isDefault": true} is supported here.',
            'invalid_patch',
            400,
          );
        }
        const result = await setDefaultLocation(board, id);
        return json(result);
      }

      if (method === 'GET') {
        const state = board.getState();
        if (!findLocation(state, id)) {
          throw new ValidationError('That location is not on your dashboard.', 'not_found', 404);
        }

        await ensureReadings(board, { ids: [id], live: true });
        const fresh = board.getState();
        return json({
          location: serializeLocation(
            findLocation(fresh, id),
            fresh,
            resolveUnits(url.searchParams, fresh.settings),
          ),
        });
      }

      return json(
        { error: { code: 'method_not_allowed', message: 'Use GET, PATCH or DELETE.' } },
        405,
      );
    }

    if (path === '/api/weather' && method === 'GET') {
      await ensureReadings(board, { live: true });
      const state = board.getState();
      return json(weatherPayload(state, resolveUnits(url.searchParams, state.settings)));
    }

    if (path === '/api/weather/refresh' && method === 'POST') {
      await ensureReadings(board, { force: true, live: true });
      const state = board.getState();
      return json(weatherPayload(state, resolveUnits(url.searchParams, state.settings)));
    }

    const weatherMatch = path.match(/^\/api\/weather\/([^/]+)$/);
    if (weatherMatch && method === 'GET') {
      const id = decodeURIComponent(weatherMatch[1]);
      const state = board.getState();
      if (!findLocation(state, id)) {
        throw new ValidationError('That location is not on your dashboard.', 'not_found', 404);
      }

      await ensureReadings(board, { ids: [id], live: true });
      const fresh = board.getState();
      return json({
        location: serializeLocation(
          findLocation(fresh, id),
          fresh,
          resolveUnits(url.searchParams, fresh.settings),
        ),
      });
    }

    if (path === '/api/settings' && (method === 'PUT' || method === 'PATCH')) {
      const body = await readJson(request);
      const settings = await updateSettings(board, body);
      return json({ settings });
    }

    return fail(404, 'not_found', `No API route for ${method} ${path}.`);
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(error.status ?? 400, error.code ?? 'invalid_request', error.message);
    }

    console.error('[api]', error);
    return fail(500, 'internal_error', 'Something went wrong on the server.');
  }
}

/* --------------------------------- entry ---------------------------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (!env.DB || !env.ASSETS) {
        return fail(500, 'misconfigured', 'The site is missing its database or assets binding.');
      }

      if (url.pathname === '/signin' || url.pathname === '/signup') {
        await ensureSchema(env.DB);
        return await serveAsset(env, url, '/auth.html', request);
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        await ensureSchema(env.DB);
        const session = await findSession(env.DB, readSessionToken(request));
        if (!session) return redirect('/signin?next=%2F');

        return await serveAsset(env, url, '/dashboard.html', request);
      }

      if (url.pathname.startsWith('/api/')) {
        await ensureSchema(env.DB);
        const session = await findSession(env.DB, readSessionToken(request));
        return await handleApi(request, env, url, session);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('[worker]', error);
      return fail(500, 'internal_error', 'Something went wrong on the server.');
    }
  },
};
