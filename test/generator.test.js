import assert from 'node:assert/strict';
import test from 'node:test';

import { CONDITIONS, generateWeather, resolveProfile } from '../src/weather/generator.js';
import { toDisplayUnits } from '../src/weather/units.js';

const FIXED = new Date('2026-11-06T15:00:00.000Z');
const CONDITION_IDS = new Set(Object.values(CONDITIONS).map((condition) => condition.id));

test('same city, seed and moment produce identical weather', () => {
  const first = generateWeather({ city: 'Portland, OR', at: FIXED, seed: 'unit-test' });
  const second = generateWeather({ city: 'Portland, OR', at: FIXED, seed: 'unit-test' });
  assert.deepEqual(first, second);
});

test('changing the seed changes the generated weather', () => {
  const first = generateWeather({ city: 'Tokyo', at: FIXED, seed: 'seed-a' });
  const second = generateWeather({ city: 'Tokyo', at: FIXED, seed: 'seed-b' });
  assert.notDeepEqual(first, second);
});

test('readings have a complete, sane shape', () => {
  const reading = generateWeather({ city: 'Nairobi', at: FIXED, seed: 'shape' });

  assert.equal(reading.forecast.length, 5);
  assert.match(reading.current.condition.id, /^[a-z-]+$/);
  assert.ok(CONDITION_IDS.has(reading.current.condition.id));
  assert.ok(reading.current.humidity >= 20 && reading.current.humidity <= 99);
  assert.ok(reading.current.uvIndex >= 0 && reading.current.uvIndex <= 11);
  assert.ok(reading.current.low <= reading.current.high);
  assert.ok(reading.current.temperature >= reading.current.low);
  assert.ok(reading.current.temperature <= reading.current.high);
  assert.ok(reading.current.windSpeed > 0);
  assert.match(reading.current.windDirection, /^[NSEW]{1,3}$/);
  assert.ok(reading.current.gusts >= reading.current.windSpeed);
  assert.ok(reading.current.cloudCover >= 0 && reading.current.cloudCover <= 100);
  assert.ok(reading.current.precipitation >= 0);

  for (const day of reading.forecast) {
    assert.ok(CONDITION_IDS.has(day.condition.id));
    assert.ok(day.low <= day.high);
    assert.ok(day.precipitationChance >= 0 && day.precipitationChance <= 100);
  }

  const dates = reading.forecast.map((day) => Date.parse(day.date));
  for (let index = 1; index < dates.length; index += 1) {
    assert.equal(dates[index] - dates[index - 1], 86_400_000);
  }
});

test('southern hemisphere seasons are inverted', () => {
  const january = generateWeather({
    city: 'Sydney',
    at: new Date('2026-01-15T01:00:00.000Z'),
    seed: 'season',
  });
  const july = generateWeather({
    city: 'Sydney',
    at: new Date('2026-07-15T01:00:00.000Z'),
    seed: 'season',
  });

  assert.ok(
    january.current.temperature > july.current.temperature + 5,
    `expected a warm January (${january.current.temperature}) and cool July (${july.current.temperature})`,
  );
});

test('polar night is handled without NaN values', () => {
  const reading = generateWeather({
    city: 'Longyearbyen',
    latitude: 78.22,
    longitude: 15.65,
    at: new Date('2026-12-21T12:00:00.000Z'),
    seed: 'polar',
  });

  assert.equal(reading.sun.polar, 'night');
  assert.equal(reading.sun.daylightHours, 0);
  assert.equal(reading.sun.sunrise, null);
  assert.equal(reading.sun.sunset, null);
  assert.equal(reading.current.uvIndex, 0);
  assert.ok(Number.isFinite(reading.current.temperature));
});

test('nighttime has no UV and can switch to a night condition', () => {
  const reading = generateWeather({
    city: 'London',
    at: new Date('2026-06-15T23:00:00.000Z'),
    seed: 'night',
  });

  assert.equal(reading.current.uvIndex, 0);
  assert.ok(['sunny', 'partly-cloudy'].every((id) => id !== reading.current.condition.id));
});

test('known cities resolve to real coordinates; unknown cities are stable', () => {
  const tokyo = resolveProfile('Tokyo');
  assert.equal(tokyo.country, 'Japan');
  assert.ok(Math.abs(tokyo.latitude - 35.68) < 0.01);

  const unknownA = resolveProfile('Somewhereville');
  const unknownB = resolveProfile('Somewhereville');
  assert.equal(unknownA.latitude, unknownB.latitude);
  assert.equal(unknownA.longitude, unknownB.longitude);
  assert.ok(unknownA.latitude >= -56 && unknownA.latitude <= 72);
});

test('stores metric values and converts them for imperial display', () => {
  const reading = generateWeather({ city: 'Chicago', at: FIXED, seed: 'units' });
  const metric = toDisplayUnits(reading, 'metric');
  const imperial = toDisplayUnits(reading, 'imperial');

  assert.equal(metric.current.temperature, reading.current.temperature);
  assert.equal(
    imperial.current.temperature,
    Math.round(((reading.current.temperature * 9) / 5 + 32) * 10) / 10,
  );
  assert.equal(imperial.unitLabels.temperature, '°F');
  assert.equal(imperial.unitLabels.wind, 'mph');
  assert.equal(imperial.unitLabels.precipitation, 'in');
  assert.equal(imperial.forecast.length, reading.forecast.length);
  assert.ok(imperial.current.pressure < 40 && imperial.current.pressure > 25);
  assert.ok(imperial.current.gusts >= 0);
  assert.equal(
    imperial.current.precipitation,
    Math.round((reading.current.precipitation / 25.4) * 100) / 100,
  );
});
