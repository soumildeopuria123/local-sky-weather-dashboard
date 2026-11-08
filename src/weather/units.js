/** Canonical readings are stored in metric units; display converts on the way out. */

export const UNIT_SYSTEMS = ['metric', 'imperial'];

export function isUnitSystem(value) {
  return UNIT_SYSTEMS.includes(value);
}

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function convertTemperature(celsius, units) {
  return units === 'imperial' ? celsius * 9 / 5 + 32 : celsius;
}

export function convertWindSpeed(kmh, units) {
  return units === 'imperial' ? kmh * 0.621371 : kmh;
}

export function convertPressure(hpa, units) {
  return units === 'imperial' ? hpa * 0.02953 : hpa;
}

export function convertVisibility(km, units) {
  return units === 'imperial' ? km * 0.621371 : km;
}

export function convertPrecipitation(mm, units) {
  return units === 'imperial' ? mm / 25.4 : mm;
}

export function unitLabels(units) {
  return units === 'imperial'
    ? {
        temperature: '°F',
        wind: 'mph',
        pressure: 'inHg',
        visibility: 'mi',
        precipitation: 'in',
        distance: 'mi',
      }
    : {
        temperature: '°C',
        wind: 'km/h',
        pressure: 'hPa',
        visibility: 'km',
        precipitation: 'mm',
        distance: 'km',
      };
}

/** Serializes a stored metric reading into the requested display units. */
export function toDisplayUnits(reading, units) {
  const imperial = units === 'imperial';
  const labels = unitLabels(units);
  const current = reading.current;

  return {
    units,
    unitLabels: labels,
    current: {
      ...current,
      temperature: round(convertTemperature(current.temperature, units), imperial ? 1 : 0),
      feelsLike: round(convertTemperature(current.feelsLike, units), imperial ? 1 : 0),
      high: round(convertTemperature(current.high, units), 0),
      low: round(convertTemperature(current.low, units), 0),
      windSpeed: round(convertWindSpeed(current.windSpeed, units), 1),
      gusts: round(
        convertWindSpeed(current.gusts ?? current.windSpeed, units),
        0,
      ),
      pressure: round(convertPressure(current.pressure, units), imperial ? 2 : 0),
      visibility: round(convertVisibility(current.visibility, units), 1),
      precipitation: round(
        convertPrecipitation(current.precipitation ?? 0, units),
        imperial ? 2 : 1,
      ),
      cloudCover: round(current.cloudCover ?? 0, 0),
    },
    forecast: reading.forecast.map((day) => ({
      ...day,
      high: round(convertTemperature(day.high, units), 0),
      low: round(convertTemperature(day.low, units), 0),
    })),
    sun: reading.sun,
    generatedAt: reading.generatedAt,
  };
}
