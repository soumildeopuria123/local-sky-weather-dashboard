import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JsonStore } from '../src/db/store.js';
import { addLocation } from '../src/db/locations.js';
import { resolveProfile } from '../src/weather/generator.js';
import {
  CityNotFoundError,
  LiveWeatherError,
  conditionFromCode,
  fetchLiveReading,
  geocodeCity,
  searchPlaces,
} from '../src/weather/live.js';
import { ensureReadings } from '../src/weather/service.js';

const GEOCODE_FIXTURE = {
  results: [
    {
      id: 5746545,
      name: 'Portland',
      latitude: 45.52345,
      longitude: -122.67621,
      country: 'United States',
      country_code: 'US',
      admin1: 'Oregon',
      timezone: 'America/Los_Angeles',
    },
    {
      id: 4975802,
      name: 'Portland',
      latitude: 43.66147,
      longitude: -70.25533,
      country: 'United States',
      country_code: 'US',
      admin1: 'Maine',
      timezone: 'America/New_York',
    },
  ],
};

const FORECAST_FIXTURE = {
  current: {
    time: '2026-11-06T14:30',
    interval: 900,
    temperature_2m: 23.8,
    relative_humidity_2m: 55,
    apparent_temperature: 24.6,
    is_day: 1,
    precipitation: 0,
    weather_code: 0,
    cloud_cover: 16,
    pressure_msl: 1007.2,
    wind_speed_10m: 4.5,
    wind_direction_10m: 151,
    wind_gusts_10m: 12.2,
  },
  hourly: {
    time: ['2026-11-06T14:00', '2026-11-06T15:00'],
    uv_index: [3.1, 2.4],
    visibility: [24000, 24000],
    precipitation_probability: [0, 5],
  },
  daily: {
    time: ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'],
    weather_code: [0, 2, 61, 3, 95, 71],
    temperature_2m_max: [25, 24, 20, 19, 21, 15],
    temperature_2m_min: [16, 15, 14, 12, 13, 8],
    sunrise: [
      '2026-11-06T06:50',
      '2026-11-07T06:51',
      '2026-11-08T06:52',
      '2026-11-09T06:53',
      '2026-11-10T06:54',
      '2026-11-11T06:55',
    ],
    sunset: [
      '2026-11-06T17:10',
      '2026-11-07T17:09',
      '2026-11-08T17:08',
      '2026-11-09T17:07',
      '2026-11-10T17:06',
      '2026-11-11T17:05',
    ],
    uv_index_max: [4.2, 3.8, 2.1, 1.9, 2.5, 1.2],
    precipitation_probability_max: [0, 10, 80, 20, 90, 60],
  },
};

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function fakeFetch(payload, status = 200) {
  return async () => jsonResponse(payload, status);
}

test('geocodeCity resolves coordinates, country and timezone', async () => {
  const city = await geocodeCity('Portland', { fetchImpl: fakeFetch(GEOCODE_FIXTURE) });

  assert.equal(city.country, 'United States');
  assert.equal(city.region, 'Oregon');
  assert.equal(city.timezone, 'America/Los_Angeles');
  assert.equal(city.geocoded, true);
  assert.match(city.profileKey, /^geo:5746545$/);
  assert.ok(Math.abs(city.latitude - 45.52345) < 0.001);
});

test('a comma-separated hint picks the matching city', async () => {
  const city = await geocodeCity('Portland, Maine', { fetchImpl: fakeFetch(GEOCODE_FIXTURE) });
  assert.equal(city.region, 'Maine');
  assert.equal(city.longitude, -70.25533);
});

test('place search lists every match with a pickable label', async () => {
  const results = await searchPlaces('portland', { fetchImpl: fakeFetch(GEOCODE_FIXTURE) });

  assert.equal(results.length, 2);
  assert.equal(results[0].label, 'Portland, Oregon, United States');
  assert.equal(results[0].latitude, 45.52345);
  assert.equal(results[0].timezone, 'America/Los_Angeles');
  assert.equal(results[1].region, 'Maine');
  assert.equal(results[1].label, 'Portland, Maine, United States');
});

test('a comma hint narrows place search, with a fallback to the bare name', async () => {
  const asked = [];
  const texas = {
    id: 4717560,
    name: 'Paris',
    latitude: 33.66094,
    longitude: -95.55551,
    country: 'United States',
    country_code: 'US',
    admin1: 'Texas',
    timezone: 'America/Chicago',
  };

  const narrowed = await searchPlaces('Paris, Texas', {
    fetchImpl: async (url) => {
      const name = new URL(String(url)).searchParams.get('name');
      asked.push(name);
      return jsonResponse(name === 'Paris, Texas' ? { results: [texas] } : GEOCODE_FIXTURE);
    },
  });
  assert.deepEqual(asked, ['Paris, Texas']);
  assert.equal(narrowed.length, 1);
  assert.equal(narrowed[0].region, 'Texas');

  asked.length = 0;
  const fallback = await searchPlaces('Atlantis, Nowhere', {
    fetchImpl: async (url) => {
      const name = new URL(String(url)).searchParams.get('name');
      asked.push(name);
      return jsonResponse(name === 'Atlantis, Nowhere' ? {} : GEOCODE_FIXTURE);
    },
  });
  assert.deepEqual(asked, ['Atlantis, Nowhere', 'Atlantis']);
  assert.equal(fallback.length, 2);
});

test('short search text never calls the provider', async () => {
  let calls = 0;
  const results = await searchPlaces('p', {
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(GEOCODE_FIXTURE);
    },
  });

  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

test('search skips results that have no coordinates', async () => {
  const results = await searchPlaces('nowhere', {
    fetchImpl: fakeFetch({
      results: [{ name: 'Nowhere' }, { name: 'Somewhere', latitude: 1, longitude: 2 }],
    }),
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Somewhere');
  assert.equal(results[0].label, 'Somewhere');
});

test('unknown places raise CityNotFoundError', async () => {
  await assert.rejects(
    () => geocodeCity('Atlantis', { fetchImpl: fakeFetch({ results: [] }) }),
    (error) => error instanceof CityNotFoundError && error.status === 404,
  );
});

test('provider HTTP failures raise LiveWeatherError', async () => {
  await assert.rejects(
    () => geocodeCity('Tokyo', { fetchImpl: fakeFetch({ reason: 'down' }, 503) }),
    (error) => error instanceof LiveWeatherError,
  );
});

test('WMO codes map to dashboard conditions, including at night', () => {
  assert.equal(conditionFromCode(0, true).id, 'clear');
  assert.equal(conditionFromCode(0, false).icon, 'moon');
  assert.equal(conditionFromCode(0, false).tone, 'night');
  assert.equal(conditionFromCode(2, true).icon, 'partly-cloudy');
  assert.equal(conditionFromCode(61, true).id, 'light-rain');
  assert.equal(conditionFromCode(95, true).id, 'thunderstorm');
  assert.equal(conditionFromCode(71, true).id, 'light-snow');
  assert.equal(conditionFromCode(999, true).label, 'Overcast');
});

test('live readings parse into the dashboard shape', async () => {
  const reading = await fetchLiveReading(
    {
      city: 'Tokyo',
      latitude: 35.6895,
      longitude: 139.69171,
    },
    { fetchImpl: fakeFetch(FORECAST_FIXTURE) },
  );

  assert.equal(reading.source, 'live');
  assert.equal(reading.provider, 'Open-Meteo');
  assert.equal(reading.current.temperature, 23.8);
  assert.equal(reading.current.humidity, 55);
  assert.equal(reading.current.condition.id, 'clear');
  assert.equal(reading.current.uvIndex, 3);
  assert.equal(reading.current.visibility, 24);
  assert.equal(reading.current.gusts, 12);
  assert.equal(reading.current.cloudCover, 16);
  assert.equal(reading.current.windDirection, 'SSE');
  assert.equal(reading.current.high, 25);
  assert.equal(reading.current.low, 16);
  assert.equal(reading.forecast.length, 5);
  assert.equal(reading.forecast[2].condition.id, 'light-rain');
  assert.equal(reading.forecast[2].precipitationChance, 80);
  assert.equal(reading.sun.sunrise, '06:50');
  assert.equal(reading.sun.sunset, '17:10');
  assert.equal(reading.sun.daylightHours, 10.3);
});

test('service falls back to a labelled local sample when Open-Meteo is unreachable', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'local-sky-fallback-'));
  try {
    const store = await new JsonStore(path.join(directory, 'weather.json')).init();
    const profile = resolveProfile('Portland, OR');
    const location = await addLocation(store, { city: 'Portland, OR', profile });

    await ensureReadings(store, {
      ids: [location.id],
      live: true,
      fetchImpl: async () => {
        throw new Error('network blocked');
      },
    });

    const saved = store.getState().locations[0];
    assert.equal(saved.reading.source, 'sample');
    assert.equal(saved.reading.provider, 'local engine');
    assert.match(saved.reading.fallbackReason, /network blocked/);
    assert.equal(saved.reading.forecast.length, 5);
    assert.equal(saved.reading.revision, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
