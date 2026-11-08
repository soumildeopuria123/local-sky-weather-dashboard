/**
 * Keeps each saved location's reading fresh.
 *
 * Live Open-Meteo readings are preferred. If the network (or the provider)
 * fails, the deterministic local engine fills in and the reading is marked
 * source: "sample" so the UI can label it honestly.
 */

import { generateWeather } from './generator.js';
import { fetchLiveReading, geocodeCity } from './live.js';
import { dayKey } from './utils.js';

export const CACHE_TTL_MS = 10 * 60 * 1000;

function seedFor(revision, at) {
  const hour = at.toISOString().slice(0, 13);
  return `rev${revision}:${dayKey(at)}:${hour}`;
}

function isStale(location, now, force) {
  if (force) return true;
  if (!location.reading) return true;
  if (location.reading.revision !== location.revision) return true;
  const storedAt = Date.parse(location.reading.storedAt ?? '');
  if (!Number.isFinite(storedAt)) return true;
  return now - storedAt > CACHE_TTL_MS;
}

function sampleReading(location, { revision, at, coords, reason }) {
  const reading = generateWeather({
    city: location.city,
    country: location.country,
    latitude: coords.latitude,
    longitude: coords.longitude,
    at,
    seed: seedFor(revision, at),
  });

  return {
    ...reading,
    source: 'sample',
    provider: 'local engine',
    fallbackReason: reason ?? 'Live weather is turned off.',
  };
}

async function prepareReading(location, { revision, at, live, fetchImpl }) {
  const upgrades = {};
  const coords = {
    latitude: location.latitude,
    longitude: location.longitude,
  };

  // Older locations (or cities added while offline) may only have synthetic
  // coordinates. Upgrade them to real ones the next time we have network.
  if (live && location.geocoded !== true) {
    try {
      const geo = await geocodeCity(location.city, { fetchImpl });
      coords.latitude = geo.latitude;
      coords.longitude = geo.longitude;
      Object.assign(upgrades, {
        latitude: geo.latitude,
        longitude: geo.longitude,
        region: geo.region ?? location.region ?? null,
        country: geo.country ?? location.country ?? null,
        timezone: geo.timezone ?? null,
        geocoded: true,
        profileKey: geo.profileKey,
      });
    } catch {
      // Keep the stored coordinates; the live call below will report failure.
    }
  }

  if (live) {
    try {
      const reading = await fetchLiveReading({ ...location, ...coords }, { fetchImpl });
      return {
        upgrades,
        revision,
        reading: { ...reading, revision, storedAt: new Date().toISOString() },
      };
    } catch (error) {
      return {
        upgrades,
        revision,
        reading: {
          ...sampleReading(location, { revision, at, coords, reason: error.message }),
          revision,
          storedAt: new Date().toISOString(),
        },
      };
    }
  }

  return {
    upgrades,
    revision,
    reading: {
      ...sampleReading(location, { revision, at, coords }),
      revision,
      storedAt: new Date().toISOString(),
    },
  };
}

/**
 * @param {import('../db/store.js').JsonStore} store
 * @param {{ force?: boolean, ids?: string[]|null, at?: Date, live?: boolean, fetchImpl?: Function }} options
 */
export async function ensureReadings(
  store,
  { force = false, ids = null, at = new Date(), live = true, fetchImpl } = {},
) {
  const now = Date.now();
  const targetIds = ids ? new Set(ids) : null;

  const targets = store
    .getState()
    .locations.filter(
      (location) => (!targetIds || targetIds.has(location.id)) && isStale(location, now, force),
    );

  if (targets.length === 0) return store.getState();

  const prepared = await Promise.all(
    targets.map(async (location) => {
      const revision = force ? location.revision + 1 : location.revision;
      const result = await prepareReading(location, { revision, at, live, fetchImpl });
      return { id: location.id, ...result };
    }),
  );

  await store.update((state) => {
    for (const entry of prepared) {
      const location = state.locations.find((candidate) => candidate.id === entry.id);
      if (!location) continue;

      Object.assign(location, entry.upgrades);
      location.revision = Math.max(location.revision, entry.revision);
      location.reading = entry.reading;
    }
  });

  return store.getState();
}
