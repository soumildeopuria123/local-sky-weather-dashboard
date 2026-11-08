/**
 * Live weather via Open-Meteo (https://open-meteo.com/).
 * No API key is required. If these requests fail, the service layer falls back
 * to the local generator and labels the reading as an offline sample.
 */

import {
  compassFromDegrees,
  clamp,
  normalizeCityName,
  roundTo,
  slugifyCity,
} from './utils.js';

export const LIVE_PROVIDER = 'Open-Meteo';
export const LIVE_PROVIDER_URL = 'https://open-meteo.com/';

const GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 8000;

export class CityNotFoundError extends Error {
  constructor(city) {
    super(`No place called "${city}" was found.`);
    this.name = 'CityNotFoundError';
    this.code = 'city_not_found';
    this.status = 404;
  }
}

export class LiveWeatherError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'LiveWeatherError';
    this.code = 'live_weather_unavailable';
    this.status = 502;
  }
}

async function fetchJson(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new LiveWeatherError('No fetch implementation is available in this runtime.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'LocalSky/1.0 (local weather dashboard)',
      },
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'the request timed out' : error?.message;
    throw new LiveWeatherError(`Could not reach ${LIVE_PROVIDER}: ${reason}.`, { cause: error });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new LiveWeatherError(`${LIVE_PROVIDER} responded with HTTP ${response.status}.`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new LiveWeatherError(`${LIVE_PROVIDER} returned a response that was not valid JSON.`, {
      cause: error,
    });
  }
}

/**
 * Resolves a typed city name to real coordinates, region, country and timezone.
 * A second comma-separated part is treated as a hint ("Portland, OR").
 */
export async function geocodeCity(city, { fetchImpl } = {}) {
  const cleaned = normalizeCityName(city);
  if (!cleaned) throw new CityNotFoundError(city);

  const [primary, ...rest] = cleaned.split(',').map((part) => part.trim());
  const query = primary || cleaned;
  const hint = rest.join(', ').trim().toLowerCase();

  const params = new URLSearchParams({
    name: query,
    count: '10',
    language: 'en',
    format: 'json',
  });

  const data = await fetchJson(`${GEOCODE_ENDPOINT}?${params.toString()}`, fetchImpl);
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) throw new CityNotFoundError(cleaned);

  let result = results[0];
  if (hint) {
    const match = results.find((candidate) => {
      const values = [candidate.country, candidate.country_code, candidate.admin1]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      return values.some(
        (value) => value === hint || value.startsWith(`${hint} `) || value.includes(hint) || hint.includes(value),
      );
    });
    if (match) result = match;
  }

  return {
    city: cleaned,
    name: result.name,
    region: result.admin1 ?? null,
    country: result.country ?? null,
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone ?? null,
    geocoded: true,
    profileKey: `geo:${result.id ?? `${result.latitude},${result.longitude}`}`,
  };
}

function placeLabel(result) {
  const parts = [normalizeCityName(result.name)];
  if (result.admin1 && result.admin1 !== result.name) parts.push(result.admin1);
  if (result.country) parts.push(result.country);
  return parts.filter(Boolean).join(', ');
}

/** Converts one geocoder result into the shape the search box lists. */
export function toPlaceResult(result) {
  const latitude = Number(result?.latitude);
  const longitude = Number(result?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: result.id ?? `${latitude},${longitude}`,
    name: normalizeCityName(result.name) || 'Unnamed place',
    region: result.admin1 ?? null,
    country: result.country ?? null,
    countryCode: result.country_code ?? null,
    latitude,
    longitude,
    timezone: result.timezone ?? null,
    label: placeLabel(result),
  };
}

/**
 * Search-as-you-type place lookup. Returns every matching place with its region,
 * country and exact coordinates, so the user can pick the right one.
 */
export async function searchPlaces(query, { fetchImpl, count = 10 } = {}) {
  const cleaned = normalizeCityName(query);
  if (cleaned.length < 2) return [];

  // Try the full text first so "Paris, Texas" narrows to Texas. If the provider
  // does not recognise the hint, retry with just the place name.
  const primary = cleaned.split(',')[0].trim() || cleaned;
  const attempts = primary === cleaned ? [cleaned] : [cleaned, primary];
  const size = String(Math.max(1, Math.min(100, count)));

  for (const name of attempts) {
    const params = new URLSearchParams({
      name,
      count: size,
      language: 'en',
      format: 'json',
    });

    const data = await fetchJson(`${GEOCODE_ENDPOINT}?${params.toString()}`, fetchImpl);
    const results = (Array.isArray(data?.results) ? data.results : [])
      .map(toPlaceResult)
      .filter(Boolean);
    if (results.length > 0) return results;
  }

  return [];
}

/* --------------------------- WMO weather codes --------------------------- */

const WMO_CONDITIONS = {
  0: { id: 'clear', label: 'Clear sky', icon: 'sun', nightIcon: 'moon', nightLabel: 'Clear', tone: 'sunny' },
  1: { id: 'mainly-clear', label: 'Mainly clear', icon: 'sun', nightIcon: 'moon', nightLabel: 'Mainly clear', tone: 'sunny' },
  2: { id: 'partly-cloudy', label: 'Partly cloudy', icon: 'partly-cloudy', nightIcon: 'partly-cloudy-night', tone: 'cloudy' },
  3: { id: 'overcast', label: 'Overcast', icon: 'cloudy', tone: 'cloudy' },
  45: { id: 'fog', label: 'Fog', icon: 'fog', tone: 'fog' },
  48: { id: 'fog', label: 'Freezing fog', icon: 'fog', tone: 'fog' },
  51: { id: 'drizzle', label: 'Light drizzle', icon: 'light-rain', tone: 'rain' },
  53: { id: 'drizzle', label: 'Drizzle', icon: 'light-rain', tone: 'rain' },
  55: { id: 'drizzle', label: 'Heavy drizzle', icon: 'light-rain', tone: 'rain' },
  56: { id: 'freezing-drizzle', label: 'Freezing drizzle', icon: 'light-rain', tone: 'rain' },
  57: { id: 'freezing-drizzle', label: 'Freezing drizzle', icon: 'light-rain', tone: 'rain' },
  61: { id: 'light-rain', label: 'Light rain', icon: 'light-rain', tone: 'rain' },
  63: { id: 'rain', label: 'Rain', icon: 'rain', tone: 'rain' },
  65: { id: 'heavy-rain', label: 'Heavy rain', icon: 'rain', tone: 'rain' },
  66: { id: 'freezing-rain', label: 'Freezing rain', icon: 'rain', tone: 'rain' },
  67: { id: 'freezing-rain', label: 'Freezing rain', icon: 'rain', tone: 'rain' },
  71: { id: 'light-snow', label: 'Light snow', icon: 'snow', tone: 'snow' },
  73: { id: 'snow', label: 'Snow', icon: 'snow', tone: 'snow' },
  75: { id: 'heavy-snow', label: 'Heavy snow', icon: 'snow', tone: 'snow' },
  77: { id: 'snow-grains', label: 'Snow grains', icon: 'snow', tone: 'snow' },
  80: { id: 'light-showers', label: 'Light showers', icon: 'light-rain', tone: 'rain' },
  81: { id: 'rain-showers', label: 'Rain showers', icon: 'rain', tone: 'rain' },
  82: { id: 'heavy-showers', label: 'Heavy showers', icon: 'rain', tone: 'rain' },
  85: { id: 'snow-showers', label: 'Snow showers', icon: 'snow', tone: 'snow' },
  86: { id: 'snow-showers', label: 'Heavy snow showers', icon: 'snow', tone: 'snow' },
  95: { id: 'thunderstorm', label: 'Thunderstorm', icon: 'thunderstorm', tone: 'storm' },
  96: { id: 'thunderstorm', label: 'Thunderstorm with hail', icon: 'thunderstorm', tone: 'storm' },
  99: { id: 'thunderstorm', label: 'Thunderstorm with hail', icon: 'thunderstorm', tone: 'storm' },
};

export function conditionFromCode(code, isDay = true) {
  const mapping = WMO_CONDITIONS[Number(code)] ?? WMO_CONDITIONS[3];
  const useNight = !isDay && Boolean(mapping.nightIcon);
  return {
    id: useNight ? `${mapping.id}-night` : mapping.id,
    label: useNight && mapping.nightLabel ? mapping.nightLabel : mapping.label,
    icon: useNight ? mapping.nightIcon : mapping.icon,
    tone: useNight ? 'night' : mapping.tone,
  };
}

/* ------------------------------ live reading ---------------------------- */

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hourlyValue(hourly, key, currentTime) {
  const times = hourly?.time;
  const values = hourly?.[key];
  if (!Array.isArray(times) || !Array.isArray(values)) return null;

  const hourPrefix = String(currentTime ?? '').slice(0, 13);
  const index = times.findIndex((time) => String(time).slice(0, 13) === hourPrefix);
  if (index === -1) return null;

  const value = values[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clockTime(iso) {
  return typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : null;
}

/**
 * Fetches current conditions, hourly UV/visibility and a 5-day forecast.
 * Returns the same metric shape the local generator produces, plus a few
 * live-only details (gusts, precipitation, cloud cover) and a source marker.
 */
export async function fetchLiveReading(location, { fetchImpl } = {}) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new LiveWeatherError('This location has no coordinates to fetch weather for.');
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'is_day',
      'precipitation',
      'weather_code',
      'cloud_cover',
      'pressure_msl',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
    ].join(','),
    hourly: ['uv_index', 'visibility', 'precipitation_probability'].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'sunrise',
      'sunset',
      'uv_index_max',
      'precipitation_probability_max',
    ].join(','),
    timezone: 'auto',
    forecast_days: '6',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });

  const data = await fetchJson(`${FORECAST_ENDPOINT}?${params.toString()}`, fetchImpl);
  const current = data?.current;
  const daily = data?.daily;

  if (!current || !Array.isArray(daily?.time) || daily.time.length === 0) {
    throw new LiveWeatherError(`${LIVE_PROVIDER} returned incomplete weather data.`);
  }

  const isDay = current.is_day !== 0;
  const temperature = numberOr(current.temperature_2m, 0);
  const high = numberOr(daily.temperature_2m_max?.[0], temperature + 2);
  const low = numberOr(daily.temperature_2m_min?.[0], temperature - 2);
  const windSpeed = numberOr(current.wind_speed_10m, 0);
  const windDegrees = numberOr(current.wind_direction_10m, 0);
  const condition = conditionFromCode(current.weather_code, isDay);

  const uvFromHourly = hourlyValue(data.hourly, 'uv_index', current.time);
  const uv =
    uvFromHourly ?? numberOr(daily.uv_index_max?.[0], 0);
  const visibilityMeters = hourlyValue(data.hourly, 'visibility', current.time);
  const precipitationChance =
    hourlyValue(data.hourly, 'precipitation_probability', current.time) ??
    numberOr(daily.precipitation_probability_max?.[0], 0);

  const sunriseRaw = daily.sunrise?.[0] ?? null;
  const sunsetRaw = daily.sunset?.[0] ?? null;
  const daylightHours =
    sunriseRaw && sunsetRaw
      ? roundTo((Date.parse(sunsetRaw) - Date.parse(sunriseRaw)) / 3_600_000, 1)
      : 0;

  const forecast = daily.time.slice(0, 5).map((date, index) => ({
    date,
    high: roundTo(numberOr(daily.temperature_2m_max?.[index], temperature), 0),
    low: roundTo(numberOr(daily.temperature_2m_min?.[index], temperature), 0),
    precipitationChance: clamp(
      Math.round(numberOr(daily.precipitation_probability_max?.[index], 0)),
      0,
      100,
    ),
    condition: conditionFromCode(daily.weather_code?.[index], true),
  }));

  return {
    id: slugifyCity(location.city),
    source: 'live',
    provider: LIVE_PROVIDER,
    observedAt: current.time ?? null,
    current: {
      temperature: roundTo(temperature, 1),
      feelsLike: roundTo(numberOr(current.apparent_temperature, temperature), 1),
      humidity: roundTo(clamp(numberOr(current.relative_humidity_2m, 50), 0, 100), 0),
      windSpeed: roundTo(Math.max(0, windSpeed), 1),
      windDegrees: Math.round(windDegrees),
      windDirection: compassFromDegrees(windDegrees),
      gusts: roundTo(Math.max(0, numberOr(current.wind_gusts_10m, windSpeed)), 0),
      pressure: roundTo(numberOr(current.pressure_msl, 1013), 0),
      uvIndex: roundTo(clamp(uv, 0, 12), 0),
      visibility: roundTo(
        Math.max(0, visibilityMeters == null ? 20 : visibilityMeters / 1000),
        1,
      ),
      precipitation: roundTo(Math.max(0, numberOr(current.precipitation, 0)), 1),
      precipitationChance: clamp(Math.round(precipitationChance), 0, 100),
      cloudCover: roundTo(clamp(numberOr(current.cloud_cover, 0), 0, 100), 0),
      condition,
      high: roundTo(high, 0),
      low: roundTo(low, 0),
    },
    forecast,
    sun: {
      sunrise: clockTime(sunriseRaw),
      sunset: clockTime(sunsetRaw),
      daylightHours,
      polar: null,
    },
    generatedAt: new Date().toISOString(),
  };
}
