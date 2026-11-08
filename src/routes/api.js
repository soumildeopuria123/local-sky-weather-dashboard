/**
 * JSON API for the dashboard. Weather is fetched live from Open-Meteo in the
 * service layer; if that is unavailable, a labelled local sample is served.
 */

import {
  addLocation,
  findLocation,
  removeLocation,
  sanitizeCityInput,
  setDefaultLocation,
  updateSettings,
  ValidationError,
} from '../db/locations.js';
import { resolveProfile } from '../weather/generator.js';
import {
  CityNotFoundError,
  geocodeCity,
  LIVE_PROVIDER,
  LiveWeatherError,
  searchPlaces,
} from '../weather/live.js';
import { ensureReadings } from '../weather/service.js';
import { isUnitSystem, toDisplayUnits, unitLabels } from '../weather/units.js';
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

function sendEmpty(res, status) {
  res.writeHead(status, { 'cache-control': 'no-store' });
  res.end();
}

function fail(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function resolveUnits(searchParams, settings) {
  const requested = searchParams.get('units');
  if (isUnitSystem(requested)) return requested;
  return isUnitSystem(settings.units) ? settings.units : 'metric';
}

function sortLocations(locations, settings) {
  return [...locations].sort((a, b) => {
    const aDefault = a.id === settings.defaultLocationId ? 1 : 0;
    const bDefault = b.id === settings.defaultLocationId ? 1 : 0;
    if (aDefault !== bDefault) return bDefault - aDefault;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
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

async function resolveCityProfile(city, live) {
  if (live) {
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
      // Network/provider problem: still let the city be saved with a local profile.
      return resolveProfile(city);
    }
  }
  return resolveProfile(city);
}

/**
 * @returns {Promise<boolean>} true when the request was an API route.
 */
export async function handleApi(req, res, { url, store, user = null, live = true }) {
  if (!url.pathname.startsWith('/api/')) return false;

  try {
    const { pathname, searchParams } = url;
    const method = req.method ?? 'GET';

    if (pathname === '/api/health' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        engine: 'local-generator',
        provider: LIVE_PROVIDER,
        live,
        time: new Date().toISOString(),
      });
      return true;
    }

    if (!user || !store) {
      fail(res, 401, 'auth_required', 'Sign in to open your weather dashboard.');
      return true;
    }

    if (pathname === '/api/geocode' && method === 'GET') {
      if (!live) {
        throw new ValidationError(
          'Place search needs live mode. Start the app without WEATHER_SOURCE=local to search for places.',
          'live_required',
          503,
        );
      }

      const query = String(searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim();
      if (query.length < 2) {
        sendJson(res, 200, { results: [] });
        return true;
      }
      if (query.length > 80) {
        throw new ValidationError('Search text must be 80 characters or fewer.', 'query_too_long', 400);
      }

      try {
        const results = await searchPlaces(query, { count: 10 });
        sendJson(res, 200, { results });
      } catch (error) {
        if (error instanceof LiveWeatherError) {
          fail(
            res,
            502,
            'geocode_unavailable',
            'Place search is unavailable right now. You can still type a place name and press Add.',
          );
          return true;
        }
        throw error;
      }
      return true;
    }

    if (pathname === '/api/locations' && method === 'GET') {
      sendJson(res, 200, locationsPayload(store.getState()));
      return true;
    }

    if (pathname === '/api/locations' && method === 'POST') {
      const body = await readJsonBody(req);
      const chosen = readPlaceInput(body.place);
      const city = sanitizeCityInput(chosen?.city ?? body.city);
      const profile = chosen ?? (await resolveCityProfile(city, live));
      const location = await addLocation(store, { city, profile });

      await ensureReadings(store, { ids: [location.id], live });

      const state = store.getState();
      const saved = findLocation(state, location.id);
      sendJson(res, 201, {
        location: serializeLocation(saved, state, resolveUnits(searchParams, state.settings)),
      });
      return true;
    }

    const locationMatch = pathname.match(/^\/api\/locations\/([^/]+)$/);
    if (locationMatch) {
      const id = decodeURIComponent(locationMatch[1]);

      if (method === 'DELETE') {
        await removeLocation(store, id);
        sendEmpty(res, 204);
        return true;
      }

      if (method === 'PATCH') {
        const body = await readJsonBody(req);
        if (body.isDefault !== true) {
          throw new ValidationError(
            'Only {"isDefault": true} is supported here.',
            'invalid_patch',
            400,
          );
        }
        const result = await setDefaultLocation(store, id);
        sendJson(res, 200, result);
        return true;
      }

      if (method === 'GET') {
        const state = store.getState();
        const location = findLocation(state, id);
        if (!location) throw new ValidationError('That location is not on your dashboard.', 'not_found', 404);
        await ensureReadings(store, { ids: [id], live });
        const fresh = store.getState();
        sendJson(res, 200, {
          location: serializeLocation(
            findLocation(fresh, id),
            fresh,
            resolveUnits(searchParams, fresh.settings),
          ),
        });
        return true;
      }

      sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET, PATCH or DELETE.' } });
      return true;
    }

    if (pathname === '/api/weather' && method === 'GET') {
      await ensureReadings(store, { live });
      const state = store.getState();
      sendJson(res, 200, weatherPayload(state, resolveUnits(searchParams, state.settings)));
      return true;
    }

    if (pathname === '/api/weather/refresh' && method === 'POST') {
      await ensureReadings(store, { force: true, live });
      const state = store.getState();
      sendJson(res, 200, weatherPayload(state, resolveUnits(searchParams, state.settings)));
      return true;
    }

    const weatherMatch = pathname.match(/^\/api\/weather\/([^/]+)$/);
    if (weatherMatch && method === 'GET') {
      const id = decodeURIComponent(weatherMatch[1]);
      const state = store.getState();
      if (!findLocation(state, id)) {
        throw new ValidationError('That location is not on your dashboard.', 'not_found', 404);
      }
      await ensureReadings(store, { ids: [id], live });
      const fresh = store.getState();
      sendJson(res, 200, {
        location: serializeLocation(
          findLocation(fresh, id),
          fresh,
          resolveUnits(searchParams, fresh.settings),
        ),
      });
      return true;
    }

    if (pathname === '/api/settings' && (method === 'PUT' || method === 'PATCH')) {
      const body = await readJsonBody(req);
      const settings = await updateSettings(store, body);
      sendJson(res, 200, { settings });
      return true;
    }

    sendJson(res, 404, {
      error: { code: 'not_found', message: `No API route for ${method} ${pathname}.` },
    });
    return true;
  } catch (error) {
    if (error instanceof ValidationError) {
      fail(res, error.status ?? 400, error.code ?? 'invalid_request', error.message);
      return true;
    }
    console.error('[api]', error);
    fail(res, 500, 'internal_error', 'Something went wrong on the server.');
    return true;
  }
}
