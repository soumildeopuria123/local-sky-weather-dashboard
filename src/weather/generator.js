/**
 * The local weather engine.
 *
 * There is no external API here: a city resolves to a stable climate profile
 * (from a small table of real coordinates, or a deterministic pseudo-location
 * for anything else), and weather is generated from seeded randomness plus a
 * seasonal and diurnal temperature model. Same city + same seed + same moment
 * always produces the same reading, which keeps the project testable.
 */

import {
  addDays,
  clamp,
  createRng,
  dayKey,
  dayOfYear,
  formatClock,
  hashString,
  locationKey,
  mod,
  normalizeCityName,
  randomBetween,
  roundTo,
  slugifyCity,
  solarElevation,
  sunriseSunset,
} from './utils.js';

export const CONDITIONS = {
  sunny: { id: 'sunny', label: 'Sunny', icon: 'sun', tone: 'sunny' },
  partly: { id: 'partly-cloudy', label: 'Partly cloudy', icon: 'partly-cloudy', tone: 'cloudy' },
  cloudy: { id: 'cloudy', label: 'Cloudy', icon: 'cloudy', tone: 'cloudy' },
  fog: { id: 'fog', label: 'Fog', icon: 'fog', tone: 'fog' },
  lightRain: { id: 'light-rain', label: 'Light rain', icon: 'light-rain', tone: 'rain' },
  rain: { id: 'rain', label: 'Rain', icon: 'rain', tone: 'rain' },
  storm: { id: 'thunderstorm', label: 'Thunderstorm', icon: 'thunderstorm', tone: 'storm' },
  snow: { id: 'snow', label: 'Snow', icon: 'snow', tone: 'snow' },
  clearNight: { id: 'clear-night', label: 'Clear', icon: 'moon', tone: 'night' },
  partlyNight: { id: 'partly-cloudy-night', label: 'Partly cloudy', icon: 'partly-cloudy-night', tone: 'night' },
};

export const WET_CONDITION_IDS = new Set(['light-rain', 'rain', 'thunderstorm', 'snow']);

const CONDITION_IDS = new Set(Object.values(CONDITIONS).map((condition) => condition.id));

/**
 * A compact gazetteer so well-known cities get believable coordinates,
 * countries and (for coastal cities) a maritime climate. Unknown places fall
 * back to deterministic pseudo-coordinates, so *any* name works.
 */
const PRESETS = [
  ['Portland', 'Oregon', 'United States', 45.52, -122.68, 15, true],
  ['Seattle', 'Washington', 'United States', 47.61, -122.33, 53, true],
  ['San Francisco', 'California', 'United States', 37.77, -122.42, 16, true],
  ['Los Angeles', 'California', 'United States', 34.05, -118.24, 71, true],
  ['New York', 'New York', 'United States', 40.71, -74.01, 10, true],
  ['Chicago', 'Illinois', 'United States', 41.88, -87.63, 181, false],
  ['Austin', 'Texas', 'United States', 30.27, -97.74, 149, false],
  ['Denver', 'Colorado', 'United States', 39.74, -104.99, 1609, false],
  ['Miami', 'Florida', 'United States', 25.76, -80.19, 2, true],
  ['Vancouver', 'British Columbia', 'Canada', 49.28, -123.12, 70, true],
  ['Toronto', 'Ontario', 'Canada', 43.65, -79.38, 76, false],
  ['Mexico City', 'Mexico City', 'Mexico', 19.43, -99.13, 2240, false],
  ['Bogota', 'Bogota', 'Colombia', 4.71, -74.07, 2640, false],
  ['Lima', 'Lima', 'Peru', -12.05, -77.04, 154, true],
  ['Sao Paulo', 'Sao Paulo', 'Brazil', -23.55, -46.63, 760, false],
  ['Buenos Aires', 'Buenos Aires', 'Argentina', -34.6, -58.38, 25, true],
  ['London', 'England', 'United Kingdom', 51.51, -0.13, 11, true],
  ['Paris', 'Ile-de-France', 'France', 48.86, 2.35, 35, false],
  ['Berlin', 'Berlin', 'Germany', 52.52, 13.4, 34, false],
  ['Madrid', 'Madrid', 'Spain', 40.42, -3.7, 667, false],
  ['Rome', 'Lazio', 'Italy', 41.9, 12.5, 21, true],
  ['Lisbon', 'Lisbon', 'Portugal', 38.72, -9.14, 2, true],
  ['Oslo', 'Oslo', 'Norway', 59.91, 10.75, 23, true],
  ['Reykjavik', 'Capital Region', 'Iceland', 64.15, -21.94, 61, true],
  ['Cairo', 'Cairo', 'Egypt', 30.04, 31.24, 23, false],
  ['Lagos', 'Lagos', 'Nigeria', 6.52, 3.38, 41, true],
  ['Nairobi', 'Nairobi', 'Kenya', -1.29, 36.82, 1795, false],
  ['Cape Town', 'Western Cape', 'South Africa', -33.92, 18.42, 25, true],
  ['Mumbai', 'Maharashtra', 'India', 19.08, 72.88, 14, true],
  ['Delhi', 'Delhi', 'India', 28.61, 77.21, 216, false],
  ['Bangkok', 'Bangkok', 'Thailand', 13.76, 100.5, 2, false],
  ['Singapore', 'Singapore', 'Singapore', 1.35, 103.82, 15, true],
  ['Tokyo', 'Tokyo', 'Japan', 35.68, 139.69, 40, true],
  ['Seoul', 'Seoul', 'South Korea', 37.57, 126.98, 38, false],
  ['Beijing', 'Beijing', 'China', 39.9, 116.4, 44, false],
  ['Sydney', 'New South Wales', 'Australia', -33.87, 151.21, 58, true],
  ['Melbourne', 'Victoria', 'Australia', -37.81, 144.96, 31, true],
  ['Auckland', 'Auckland', 'New Zealand', -36.85, 174.76, 26, true],
];

const PRESET_LOOKUP = new Map();

for (const [city, region, country, latitude, longitude, elevation, maritime] of PRESETS) {
  const preset = {
    key: locationKey(city),
    city,
    region,
    country,
    latitude,
    longitude,
    elevation,
    maritime,
  };
  PRESET_LOOKUP.set(locationKey(city), preset);
  PRESET_LOOKUP.set(locationKey(`${city}, ${region}`), preset);
  PRESET_LOOKUP.set(locationKey(`${city}, ${country}`), preset);
}

function hashUnit(key, salt) {
  return hashString(`${key}|${salt}`) / 4294967295;
}

/**
 * Turns a city name (and optional coordinates) into a climate profile.
 * Pure and deterministic: no I/O, no clock reads.
 */
export function resolveProfile(city, coords = {}) {
  const name = normalizeCityName(city);
  const key = locationKey(name) || 'unknown';
  const preset = PRESET_LOOKUP.get(key) ?? PRESET_LOOKUP.get(locationKey(name.split(',')[0]));

  const latitude = Number.isFinite(coords.latitude)
    ? coords.latitude
    : preset?.latitude ?? roundTo(hashUnit(key, 'latitude') * 128 - 56, 3);
  const longitude = Number.isFinite(coords.longitude)
    ? coords.longitude
    : preset?.longitude ?? roundTo(hashUnit(key, 'longitude') * 360 - 180, 3);
  const elevation = preset?.elevation ?? Math.round(hashUnit(key, 'elevation') * 900);
  const maritime = preset?.maritime ?? hashUnit(key, 'sea') > 0.5;
  const absLatitude = Math.abs(latitude);
  const continentality = maritime
    ? 0.16 + hashUnit(key, 'continentality') * 0.18
    : 0.42 + hashUnit(key, 'continentality') * 0.34;

  return {
    key: preset?.key ?? key,
    city: name,
    region: preset?.region ?? null,
    country: preset?.country ?? (normalizeCityName(coords.country) || null),
    latitude: roundTo(latitude, 3),
    longitude: roundTo(longitude, 3),
    elevation,
    maritime,
    continentality,
    hemisphere: latitude >= 0 ? 1 : -1,
    annualMean:
      27.5 -
      0.34 * absLatitude +
      (maritime ? 1.2 : 0) -
      elevation * 0.006 +
      (hashUnit(key, 'warmth') - 0.5) * 5,
    seasonAmplitude: clamp(2.5 + 0.14 * absLatitude + continentality * 7, 2, 18),
    diurnalRange: clamp(6 + continentality * 7 + hashUnit(key, 'diurnal') * 4, 5, 17),
    humidityBias: (hashUnit(key, 'humidity') - 0.45) * 22,
    cloudBias: (hashUnit(key, 'cloud') - 0.5) * 24,
    windBias: (hashUnit(key, 'wind') - 0.5) * 10,
  };
}

function describeCondition({ meanTemperature, cloud, precipitationChance, humidity, wind, daylight }) {
  if (humidity > 92 && wind < 9 && cloud < 55) return CONDITIONS.fog;
  if (meanTemperature <= 0.5 && precipitationChance >= 52) return CONDITIONS.snow;
  if (precipitationChance >= 78 && meanTemperature >= 17) return CONDITIONS.storm;
  if (precipitationChance >= 62) return CONDITIONS.rain;
  if (precipitationChance >= 44) return CONDITIONS.lightRain;
  if (cloud >= 72) return CONDITIONS.cloudy;
  if (cloud >= 34) return CONDITIONS.partly;
  if (daylight > 0 && cloud < 34) return CONDITIONS.sunny;
  return CONDITIONS.partly;
}

/** One generated day of weather, seeded by profile + date + seed. */
function buildDay(profile, date, seed) {
  const rng = createRng(profile.key, 'day', dayKey(date), seed);
  const day = dayOfYear(date);
  const seasonalPhase = profile.hemisphere === 1 ? 200 : 18;
  const seasonal = Math.cos((2 * Math.PI * (day - seasonalPhase)) / 365.25);
  const anomaly = (rng() - 0.5) * 7;
  const meanTemperature = profile.annualMean + profile.seasonAmplitude * seasonal + anomaly;

  const cloud = clamp(randomBetween(rng, 5, 95) + profile.cloudBias, 0, 100);
  const humidity = clamp(
    randomBetween(rng, 42, 82) + profile.humidityBias + cloud * 0.22,
    22,
    99,
  );
  const wind = clamp(randomBetween(rng, 4, 24) + profile.windBias, 1, 60);
  const precipitationChance = clamp(
    Math.round((humidity - 58) * 1.45 + randomBetween(rng, -10, 20) + (100 - cloud) * 0.05),
    0,
    96,
  );
  const sun = sunriseSunset(profile.latitude, day);
  const condition = describeCondition({
    meanTemperature,
    cloud,
    precipitationChance,
    humidity,
    wind,
    daylight: sun.daylightHours,
  });

  const spread = profile.diurnalRange * (WET_CONDITION_IDS.has(condition.id) ? 0.7 : 1);
  const high = meanTemperature + spread * 0.5 + randomBetween(rng, -0.5, 1.5);
  const low = meanTemperature - spread * 0.5 + randomBetween(rng, -1.5, 0.5);

  return {
    date,
    meanTemperature,
    cloud,
    humidity,
    wind,
    precipitationChance,
    condition,
    high,
    low: Math.min(low, high - 1.5),
  };
}

/** Yesterday's weather nudges today's, so rain arrives and leaves in spells. */
function transitionCondition(previous, next, rng) {
  if (!previous) return next;

  const previousWet = WET_CONDITION_IDS.has(previous.id);
  const nextWet = WET_CONDITION_IDS.has(next.id);

  if (previousWet && !nextWet && rng() < 0.45) {
    return next.cloud >= 68 ? CONDITIONS.cloudy : CONDITIONS.partly;
  }
  if (!previousWet && nextWet && rng() < 0.35) {
    return CONDITIONS.cloudy;
  }
  return next;
}

function heatIndexCelsius(temperature, humidity) {
  if (temperature < 26.7 || humidity < 40) return temperature;
  const t = (temperature * 9) / 5 + 32;
  const h = humidity;
  const index =
    -42.379 +
    2.04901523 * t +
    10.14333127 * h -
    0.22475541 * t * h -
    0.00683783 * t * t -
    0.05481717 * h * h +
    0.00122874 * t * t * h +
    0.00085282 * t * h * h -
    0.00000199 * t * t * h * h;
  return ((index - 32) * 5) / 9;
}

function windChillCelsius(temperature, windSpeed) {
  if (temperature > 10 || windSpeed < 4.8) return temperature;
  const windFactor = windSpeed ** 0.16;
  return (
    13.12 +
    0.6215 * temperature -
    11.37 * windFactor +
    0.3965 * temperature * windFactor
  );
}

function feelsLike(temperature, humidity, windSpeed) {
  const feels = temperature >= 27
    ? heatIndexCelsius(temperature, humidity)
    : windChillCelsius(temperature, windSpeed);
  return roundTo(clamp(feels, -60, 60), 0);
}

function uvIndex(elevation, cloud) {
  if (elevation <= 0) return 0;
  const clearSky = 11.5 * Math.sin((elevation * Math.PI) / 180);
  return roundTo(clamp(clearSky * (1 - cloud / 130), 0, 11), 0);
}

function precipitationFor(condition) {
  switch (condition.id) {
    case 'light-rain':
      return 0.4;
    case 'rain':
      return 2.6;
    case 'thunderstorm':
      return 7.4;
    case 'snow':
      return 1.5;
    default:
      return 0;
  }
}

function visibilityFor(condition, cloud, humidity) {
  switch (condition.id) {
    case 'fog':
      return roundTo(clamp(randomBetweenFromCondition(condition, 0.4, 2.4, humidity), 0.3, 2.5), 1);
    case 'rain':
    case 'thunderstorm':
      return 6 + (cloud % 5);
    case 'snow':
      return 2 + (cloud % 4);
    case 'light-rain':
      return 9 + (cloud % 5);
    default:
      return 20 + (cloud % 9);
  }
}

// Visibility stays deterministic without threading an RNG through: hash the
// condition and humidity instead of drawing a fresh random number.
function randomBetweenFromCondition(condition, min, max, humidity) {
  const unit = (hashString(`${condition.id}|${Math.round(humidity)}`) % 1000) / 1000;
  return min + unit * (max - min);
}

function nightCondition(condition, isNight) {
  if (!isNight) return condition;
  if (condition.id === 'sunny') return CONDITIONS.clearNight;
  if (condition.id === 'partly-cloudy') return CONDITIONS.partlyNight;
  return condition;
}

/**
 * Generates a complete reading for one city at a point in time.
 *
 * @param {object} options
 * @param {string} options.city          City name, e.g. "Portland, OR".
 * @param {number} [options.latitude]    Optional override (from the saved location).
 * @param {number} [options.longitude]   Optional override.
 * @param {Date}   [options.at]          Moment to generate for (defaults to now).
 * @param {string} [options.seed]        Seed fragment; changing it changes the weather.
 * @param {number} [options.days]        Forecast length, default 5.
 */
export function generateWeather({
  city,
  country,
  latitude,
  longitude,
  at = new Date(),
  seed = 'baseline',
  days = 5,
} = {}) {
  const profile = resolveProfile(city, { country, latitude, longitude });
  const today = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const currentDay = buildDay(profile, today, seed);

  const solarHour = mod(
    at.getUTCHours() + at.getUTCMinutes() / 60 + profile.longitude / 15,
    24,
  );
  const solarAngle = solarElevation(profile.latitude, dayOfYear(today), solarHour);
  const isNight = solarAngle <= 0;
  const sun = sunriseSunset(profile.latitude, dayOfYear(today));

  const hourRng = createRng(profile.key, 'hour', at.toISOString().slice(0, 13), seed);
  const diurnalSwing = Math.cos((2 * Math.PI * (solarHour - 15)) / 24);

  let temperature =
    currentDay.meanTemperature + (profile.diurnalRange / 2) * diurnalSwing;
  temperature -= (currentDay.cloud / 100) * (diurnalSwing > 0 ? 2.2 : 0.8);
  if (WET_CONDITION_IDS.has(currentDay.condition.id)) temperature -= 1.2;
  temperature = clamp(temperature, currentDay.low, currentDay.high);

  const humidity = clamp(
    currentDay.humidity + (isNight ? 6 : -4) + randomBetween(hourRng, -4, 4),
    20,
    99,
  );
  const windSpeed = clamp(
    currentDay.wind * randomBetween(hourRng, 0.7, 1.35),
    1,
    65,
  );
  const windDegrees = Math.round(hashString(`${profile.key}|${seed}|${dayKey(today)}|wind`) % 360);

  const pressure = roundTo(
    1013 +
      (currentDay.precipitationChance >= 55 ? -8 : 4) +
      randomBetween(hourRng, -6, 5) -
      profile.elevation * 0.01,
    0,
  );

  const condition = nightCondition(currentDay.condition, isNight);
  const temperatureRounded = roundTo(temperature, 1);
  const daylightHours = sun.daylightHours;

  const forecast = [];
  let previousCondition = null;
  for (let index = 0; index < days; index += 1) {
    const date = addDays(today, index);
    const day = index === 0 ? currentDay : buildDay(profile, date, seed);
    const chainRng = createRng(profile.key, 'chain', dayKey(date), seed);
    const conditionForDay = transitionCondition(previousCondition, day.condition, chainRng);
    previousCondition = conditionForDay;

    forecast.push({
      date: dayKey(date),
      high: roundTo(day.high, 0),
      low: roundTo(day.low, 0),
      precipitationChance: day.precipitationChance,
      condition: conditionForDay,
    });
  }

  // Keep today's forecast row consistent with the current reading.
  forecast[0] = {
    ...forecast[0],
    high: roundTo(currentDay.high, 0),
    low: roundTo(currentDay.low, 0),
    condition: currentDay.condition,
  };

  return {
    id: slugifyCity(profile.city),
    city: profile.city,
    region: profile.region,
    country: profile.country,
    latitude: profile.latitude,
    longitude: profile.longitude,
    current: {
      temperature: roundTo(temperatureRounded, 0),
      feelsLike: feelsLike(temperatureRounded, humidity, windSpeed),
      humidity: roundTo(humidity, 0),
      windSpeed: roundTo(windSpeed, 1),
      windDegrees,
      windDirection: windDirection(windDegrees),
      pressure,
      uvIndex: uvIndex(solarAngle, currentDay.cloud),
      visibility: visibilityFor(condition, currentDay.cloud, humidity),
      precipitation: precipitationFor(currentDay.condition),
      precipitationChance: currentDay.precipitationChance,
      cloudCover: roundTo(currentDay.cloud, 0),
      gusts: roundTo(windSpeed * randomBetween(hourRng, 1.25, 1.75), 0),
      condition,
      high: roundTo(currentDay.high, 0),
      low: roundTo(currentDay.low, 0),
    },
    forecast,
    sun: {
      sunrise: sun.sunriseHour == null ? null : formatClock(sun.sunriseHour * 60),
      sunset: sun.sunsetHour == null ? null : formatClock(sun.sunsetHour * 60),
      daylightHours: roundTo(daylightHours, 1),
      polar: sun.polar,
    },
    generatedAt: at.toISOString(),
  };
}

function windDirection(degrees) {
  const points = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  return points[Math.round(mod(degrees, 360) / 22.5) % 16];
}

export { CONDITION_IDS };
