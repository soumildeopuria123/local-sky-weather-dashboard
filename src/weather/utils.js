/**
 * Small, dependency-free helpers shared by the weather engine.
 * Every random value in this project comes from these seeded generators,
 * so a given city + seed + day always produces the same weather.
 */

export const MS_PER_DAY = 86_400_000;

export const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** FNV-1a — stable across processes and machines. */
export function hashString(value) {
  const input = String(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds an RNG from any number of seed parts, e.g. createRng('tokyo', date, seed). */
export function createRng(...parts) {
  return mulberry32(hashString(parts.join('|')));
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const roundTo = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function randomBetween(rng, min, max) {
  return min + rng() * (max - min);
}

export function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/** Trims and collapses whitespace; keeps the user's capitalisation. */
export function normalizeCityName(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Case/diacritic-insensitive key used for de-duplication. */
export function locationKey(value) {
  return normalizeCityName(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** UTC calendar day, e.g. "2026-11-06". */
export function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function dayOfYear(date) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / MS_PER_DAY) + 1;
}

export function compassFromDegrees(degrees) {
  const index = Math.round(mod(degrees, 360) / 22.5) % 16;
  return COMPASS_POINTS[index];
}

/** 372 -> "06:12" */
export function formatClock(minutes) {
  const total = Math.round(mod(minutes, 1440));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Earth's axial tilt position for a day of year, in degrees. */
export function solarDeclination(day) {
  return 23.44 * Math.sin((2 * Math.PI * (day - 81)) / 365.24);
}

/**
 * Approximate sunrise/sunset in local solar hours for a latitude.
 * Returns nulls during polar day/night instead of NaN.
 */
export function sunriseSunset(latitude, day) {
  const declination = (solarDeclination(day) * Math.PI) / 180;
  const lat = (clamp(latitude, -89.5, 89.5) * Math.PI) / 180;
  const cosHourAngle = -Math.tan(lat) * Math.tan(declination);

  if (cosHourAngle >= 1) {
    return { sunriseHour: null, sunsetHour: null, daylightHours: 0, polar: 'night' };
  }
  if (cosHourAngle <= -1) {
    return { sunriseHour: null, sunsetHour: null, daylightHours: 24, polar: 'day' };
  }

  const hourAngle = (Math.acos(cosHourAngle) * 180) / Math.PI / 15;
  return {
    sunriseHour: 12 - hourAngle,
    sunsetHour: 12 + hourAngle,
    daylightHours: hourAngle * 2,
    polar: null,
  };
}

/** Sun angle above the horizon in degrees (negative at night). */
export function solarElevation(latitude, day, solarHour) {
  const declination = (solarDeclination(day) * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const hourAngle = ((solarHour - 12) * 15 * Math.PI) / 180;
  const sinElevation =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  return (Math.asin(clamp(sinElevation, -1, 1)) * 180) / Math.PI;
}

/** Stable, human-readable id for generated locations. */
export function slugifyCity(value) {
  return locationKey(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'city';
}
