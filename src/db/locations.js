/** CRUD helpers for saved locations, built on top of JsonStore. */

import { locationKey } from '../weather/utils.js';

export const MAX_LOCATIONS = 50;

export class ValidationError extends Error {
  constructor(message, code = 'invalid_request', status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.status = status;
  }
}

export function sanitizeCityInput(value) {
  const city = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!city) throw new ValidationError('Enter a city name to add.', 'city_required', 400);
  if (city.length > 80) throw new ValidationError('City names must be 80 characters or fewer.', 'city_too_long', 400);
  if (/[\u0000-\u001f]/.test(city)) throw new ValidationError('That city name contains invalid characters.', 'city_invalid', 400);
  return city;
}

export function findDuplicate(state, city, profileKey) {
  const key = locationKey(city);
  return state.locations.find((location) => {
    // Geocoded places are compared by their real identity, so two different
    // Springfields can both live on the dashboard.
    if (profileKey && location.profileKey) return location.profileKey === profileKey;
    return locationKey(location.city) === key;
  });
}

/**
 * Adds a location. Profile resolution happens in the route so the client gets
 * latitude/longitude/country even when the user only typed a bare name.
 */
export async function addLocation(store, { city, profile }) {
  return store.update((state) => {
    if (state.locations.length >= MAX_LOCATIONS) {
      throw new ValidationError(
        `You can save up to ${MAX_LOCATIONS} locations. Remove one to add another.`,
        'location_limit',
        409,
      );
    }

    const duplicate = findDuplicate(state, city, profile.profileKey ?? profile.key);
    if (duplicate) {
      throw new ValidationError(
        `${duplicate.city} is already on your dashboard.`,
        'duplicate_location',
        409,
      );
    }

    const location = {
      id: crypto.randomUUID(),
      city,
      region: profile.region ?? null,
      country: profile.country ?? null,
      timezone: profile.timezone ?? null,
      profileKey: profile.profileKey ?? profile.key ?? null,
      geocoded: Boolean(profile.geocoded),
      latitude: profile.latitude ?? null,
      longitude: profile.longitude ?? null,
      createdAt: new Date().toISOString(),
      revision: 0,
      reading: null,
    };

    state.locations.push(location);

    if (state.locations.length === 1) {
      state.settings.defaultLocationId = location.id;
    }

    return structuredClone(location);
  });
}

export async function removeLocation(store, id) {
  return store.update((state) => {
    const index = state.locations.findIndex((location) => location.id === id);
    if (index === -1) throw new ValidationError('That location is not on your dashboard.', 'not_found', 404);

    const [removed] = state.locations.splice(index, 1);

    if (state.settings.defaultLocationId === removed.id) {
      state.settings.defaultLocationId = state.locations[0]?.id ?? null;
    }

    return structuredClone(removed);
  });
}

export async function setDefaultLocation(store, id) {
  return store.update((state) => {
    const location = state.locations.find((entry) => entry.id === id);
    if (!location) throw new ValidationError('That location is not on your dashboard.', 'not_found', 404);
    state.settings.defaultLocationId = location.id;
    return { defaultLocationId: location.id };
  });
}

export async function updateSettings(store, patch) {
  return store.update((state) => {
    if (patch.units !== undefined) {
      if (patch.units !== 'metric' && patch.units !== 'imperial') {
        throw new ValidationError('Units must be "metric" or "imperial".', 'invalid_units', 400);
      }
      state.settings.units = patch.units;
    }

    if (patch.defaultLocationId !== undefined) {
      if (patch.defaultLocationId === null) {
        state.settings.defaultLocationId = null;
      } else {
        const location = state.locations.find((entry) => entry.id === patch.defaultLocationId);
        if (!location) {
          throw new ValidationError('That location is not on your dashboard.', 'not_found', 404);
        }
        state.settings.defaultLocationId = location.id;
      }
    }

    return structuredClone(state.settings);
  });
}

export function findLocation(state, id) {
  return state.locations.find((location) => location.id === id) ?? null;
}
