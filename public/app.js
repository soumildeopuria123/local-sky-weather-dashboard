/* ------------------------------------------------------------------
   Local Sky — front end.
   Everything here talks to this project's own /api routes. There are
   no third-party requests of any kind.
------------------------------------------------------------------- */

const ICONS = {
  sun: `<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="11" fill="#ffca63"/><g stroke="#ffca63" stroke-width="3.2" stroke-linecap="round"><path d="M32 8v6.5M32 49.5V56M8 32h6.5M49.5 32H56M15 15l4.6 4.6M44.4 44.4L49 49M49 15l-4.6 4.6M19.6 44.4L15 49"/></g></svg>`,
  "partly-cloudy": `<svg viewBox="0 0 64 64" fill="none"><circle cx="25" cy="24" r="9" fill="#ffca63"/><g stroke="#ffca63" stroke-width="2.4" stroke-linecap="round"><path d="M25 9v3.5M25 35.5V39M10 24h3.5M36.5 24H40M14.4 13.4l2.5 2.5M33.1 32.1l2.5 2.5M35.6 13.4l-2.5 2.5"/></g><path d="M20 50h26a8.5 8.5 0 0 0 1.2-16.9A12.4 12.4 0 0 0 23.6 30 9 9 0 0 0 20 50Z" fill="#e6edff"/></svg>`,
  cloudy: `<svg viewBox="0 0 64 64" fill="none"><path d="M18 47h28a8.5 8.5 0 0 0 1.2-16.9A12.4 12.4 0 0 0 23.6 27 9 9 0 0 0 18 47Z" fill="#dbe5fb"/><path d="M23 36.5a9 9 0 0 1 8.4-6.6" stroke="#b8c6e4" stroke-width="2" stroke-linecap="round"/></svg>`,
  fog: `<svg viewBox="0 0 64 64" fill="none"><path d="M18 41h28a8.5 8.5 0 0 0 1.2-16.9A12.4 12.4 0 0 0 23.6 21 9 9 0 0 0 18 41Z" fill="#dbe5fb"/><g stroke="#a9b8d4" stroke-width="3" stroke-linecap="round"><path d="M14 48h36M20 55h28"/></g></svg>`,
  "light-rain": `<svg viewBox="0 0 64 64" fill="none"><path d="M18 40h28a8.5 8.5 0 0 0 1.2-16.9A12.4 12.4 0 0 0 23.6 20 9 9 0 0 0 18 40Z" fill="#dbe5fb"/><g stroke="#7cc3ff" stroke-width="3" stroke-linecap="round"><path d="M25 47l-2 6M39 47l-2 6"/></g></svg>`,
  rain: `<svg viewBox="0 0 64 64" fill="none"><path d="M18 38h28a8.5 8.5 0 0 0 1.2-16.9A12.4 12.4 0 0 0 23.6 18 9 9 0 0 0 18 38Z" fill="#dbe5fb"/><g stroke="#7cc3ff" stroke-width="3.2" stroke-linecap="round"><path d="M22 45l-2.5 8M32 45l-2.5 8M42 45l-2.5 8"/></g></svg>`,
  thunderstorm: `<svg viewBox="0 0 64 64" fill="none"><path d="M18 37h28a8.5 8.5 0 0 0 1.2-16.9A12.4 12.4 0 0 0 23.6 17 9 9 0 0 0 18 37Z" fill="#dbe5fb"/><path d="M34 40l-8 12h5.6l-2 9L39 48h-5.8l1.4-8Z" fill="#ffd166"/></svg>`,
  snow: `<svg viewBox="0 0 64 64" fill="none"><path d="M18 38h28a8.5 8.5 0 0 0 1.2-16.9A12.4 12.4 0 0 0 23.6 18 9 9 0 0 0 18 38Z" fill="#dbe5fb"/><g stroke="#bfeaff" stroke-width="2.4" stroke-linecap="round"><path d="M24 45v9M20.2 47.2l7.6 4.6M27.8 47.2l-7.6 4.6M42 45v9M38.2 47.2l7.6 4.6M45.8 47.2l-7.6 4.6"/></g></svg>`,
  moon: `<svg viewBox="0 0 64 64" fill="none"><path d="M38 10a22 22 0 1 0 16 38A18 18 0 0 1 38 10Z" fill="#f2e6c3"/><circle cx="21" cy="21" r="1.6" fill="#cbbf9c"/><circle cx="16" cy="33" r="1.2" fill="#cbbf9c"/></svg>`,
  "partly-cloudy-night": `<svg viewBox="0 0 64 64" fill="none"><path d="M34 8a15 15 0 1 0 11 26A12 12 0 0 1 34 8Z" fill="#f2e6c3"/><path d="M20 51h26a8.5 8.5 0 0 0 1.2-16.9A12.4 12.4 0 0 0 23.6 31 9 9 0 0 0 20 51Z" fill="#dbe5fb"/></svg>`,
};

const STAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.6l2.7 5.4 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 9.9l6-.9L12 3.6Z"/></svg>`;
const CROSS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

const SUNRISE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v5M12 8l-2.5-2.5M12 8l2.5-2.5M4 18h16M6 14a6 6 0 0 1 12 0"/></svg>`;
const SUNSET_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V3M12 3L9.5 5.5M12 3l2.5 2.5M4 18h16M6 14a6 6 0 0 1 12 0"/></svg>`;

const state = {
  user: null,
  units: "metric",
  unitLabels: { temperature: "°C", wind: "km/h", pressure: "hPa", visibility: "km" },
  locations: [],
  settings: null,
  places: [],
  placeIndex: -1,
  selectedPlace: null,
  loaded: false,
  loading: true,
  refreshing: false,
  lastLoadedAt: 0,
};

const els = {
  dashboard: document.getElementById("dashboard"),
  skeletons: document.getElementById("skeletons"),
  empty: document.getElementById("empty"),
  welcomeName: document.getElementById("welcome-name"),
  emptyCta: document.getElementById("empty-cta"),
  banner: document.getElementById("banner"),
  mapPanel: document.getElementById("map-panel"),
  mapPins: document.getElementById("map-pins"),
  mapStatus: document.getElementById("map-status"),
  form: document.getElementById("add-form"),
  city: document.getElementById("city"),
  formError: document.getElementById("form-error"),
  placeResults: document.getElementById("place-results"),
  refresh: document.getElementById("refresh"),
  themeToggle: document.getElementById("theme-toggle"),
  themeLabel: document.querySelector(".theme-toggle-label"),
  themeColor: document.getElementById("theme-color"),
  mapImage: document.querySelector(".map-image"),
  toast: document.getElementById("toast"),
  status: document.getElementById("status"),
  accountLine: document.getElementById("account-line"),
  accountName: document.getElementById("account-name"),
  signout: document.getElementById("signout"),
  segments: Array.from(document.querySelectorAll(".seg")),
};

const AUTO_REFRESH_AFTER_MS = 10 * 60 * 1000;
const THEME_KEY = "localSkyTheme";

let toastTimer = null;

/* ------------------------------- helpers ------------------------------- */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => (
    {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]
  ));
}

function iconMarkup(name, extraClass = "") {
  const svg = ICONS[name] ?? ICONS.cloudy;
  return `<span class="ic ${extraClass}" aria-hidden="true">${svg}</span>`;
}

function dayName(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
}

function firstName(name) {
  return String(name ?? "").trim().split(/\s+/)[0] || "friend";
}

function relativeTime(isoTimestamp) {
  const then = Date.parse(isoTimestamp ?? "");
  if (!Number.isFinite(then)) return "just now";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(then));
}

function uvDescriptor(index) {
  if (index <= 2) return "Low";
  if (index <= 5) return "Moderate";
  if (index <= 7) return "High";
  if (index <= 10) return "Very high";
  return "Extreme";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}

function showFormError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
}

function clearFormError() {
  els.formError.hidden = true;
  els.formError.textContent = "";
}

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme, { persist = true } = {}) {
  const light = theme === "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";

  if (els.themeToggle) {
    const nextLabel = light ? "Switch to dark mode" : "Switch to light mode";
    els.themeToggle.setAttribute("aria-label", nextLabel);
    els.themeToggle.title = nextLabel;
  }
  if (els.themeLabel) els.themeLabel.textContent = light ? "Dark" : "Light";
  if (els.themeColor) els.themeColor.content = light ? "#eef5ff" : "#070b14";

  if (els.mapImage) {
    const source = light ? "/world-map-light.svg?v=1" : "/world-map.svg";
    if (els.mapImage.getAttribute("src") !== source) els.mapImage.src = source;
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, light ? "light" : "dark");
    } catch {
      // A blocked storage API should not stop the theme from applying.
    }
  }
}

/* --------------------------- place search --------------------------- */

let placeSearchTimer = null;
let placeSearchToken = 0;

function closePlaceResults() {
  clearTimeout(placeSearchTimer);
  els.placeResults.hidden = true;
  els.placeResults.innerHTML = "";
  els.city.setAttribute("aria-expanded", "false");
  state.places = [];
  state.placeIndex = -1;
}

function renderPlaceResults() {
  if (state.places.length === 0) {
    closePlaceResults();
    return;
  }

  els.placeResults.innerHTML = state.places
    .map((place, index) => {
      const detail = [place.region, place.country].filter(Boolean).join(" · ");
      return `
        <li
          role="option"
          id="place-option-${index}"
          data-index="${index}"
          aria-selected="${index === state.placeIndex}"
          class="${index === state.placeIndex ? "is-active" : ""}"
        >
          <span class="place-name">${escapeHtml(place.name)}</span>
          ${detail ? `<span class="place-detail">${escapeHtml(detail)}</span>` : ""}
        </li>`;
    })
    .join("");

  els.placeResults.hidden = false;
  els.city.setAttribute("aria-expanded", "true");
}

function choosePlace(index) {
  const place = state.places[index];
  if (!place) return;
  state.selectedPlace = place;
  els.city.value = place.label;
  closePlaceResults();
  els.form.requestSubmit();
}

async function runPlaceSearch(query) {
  const token = ++placeSearchToken;
  try {
    const data = await api(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (token !== placeSearchToken || els.city.value.trim() !== query) return;
    state.places = Array.isArray(data.results) ? data.results : [];
    state.placeIndex = -1;
    renderPlaceResults();
  } catch {
    if (token === placeSearchToken) closePlaceResults();
  }
}

function schedulePlaceSearch() {
  clearTimeout(placeSearchTimer);
  const query = els.city.value.trim();

  if (state.selectedPlace && query !== state.selectedPlace.label) {
    state.selectedPlace = null;
  }

  if (query.length < 2) {
    closePlaceResults();
    return;
  }

  placeSearchTimer = setTimeout(() => runPlaceSearch(query), 280);
}

function showBanner(message) {
  els.banner.hidden = false;
  els.banner.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" class="btn btn-small" data-retry>Try again</button>`;
}

function hideBanner() {
  els.banner.hidden = true;
  els.banner.innerHTML = "";
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      ...options,
    });
  } catch {
    throw new Error("Could not reach the local server. Is it still running?");
  }

  if (response.status === 401) {
    const next = `${location.pathname}${location.search}`;
    location.replace(`/signin?next=${encodeURIComponent(next)}`);
    throw new Error("Your session has ended. Please sign in again.");
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `Request failed (${response.status}).`);
  }
  return data;
}

/* -------------------------------- render -------------------------------- */

function cardHtml(location) {
  const current = location.current;
  const labels = location.unitLabels;
  const city = escapeHtml(location.city);
  const place = [location.region, location.country].filter(Boolean).map(escapeHtml).join(", ");

  const highLow = Math.round(current.high);
  const lowLow = Math.round(current.low);

  const temperatures = location.forecast.map((day) => day.high);
  const lows = location.forecast.map((day) => day.low);
  const scaleMin = Math.min(...lows);
  const scaleMax = Math.max(...temperatures);
  const scaleSpan = Math.max(1, scaleMax - scaleMin);

  const days = location.forecast
    .map((day) => {
      const left = ((day.low - scaleMin) / scaleSpan) * 100;
      const width = Math.max(8, ((day.high - day.low) / scaleSpan) * 100);
      const precip = day.precipitationChance >= 10 ? `${day.precipitationChance}%` : "";
      return `
        <li class="day" title="${escapeHtml(day.condition.label)} · high ${day.high}${labels.temperature} · low ${day.low}${labels.temperature} · ${day.precipitationChance}% chance of precipitation">
          <span class="day-name">${dayName(day.date)}</span>
          ${iconMarkup(day.condition.icon, "small")}
          <span class="day-precip">${precip}</span>
          <span class="day-temps"><b>${day.high}°</b><span>${day.low}°</span></span>
          <span class="bar" aria-hidden="true"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></i></span>
        </li>`;
    })
    .join("");

  const sunrise = location.sun.sunrise ?? (location.sun.polar === "day" ? "All day" : "None");
  const sunset = location.sun.sunset ?? (location.sun.polar === "day" ? "All day" : "None");

  const metrics = [
    { label: "Feels like", value: `${current.feelsLike}${labels.temperature}` },
    { label: "Humidity", value: `${current.humidity}%` },
    {
      label: "Wind",
      value: `${Math.round(current.windSpeed)} ${labels.wind}`,
      note: current.windDirection,
    },
    { label: "Gusts", value: `${Math.round(current.gusts ?? current.windSpeed)} ${labels.wind}` },
    { label: "UV index", value: `${current.uvIndex}`, note: uvDescriptor(current.uvIndex) },
    { label: "Pressure", value: `${current.pressure} ${labels.pressure}` },
    { label: "Visibility", value: `${current.visibility} ${labels.visibility}` },
    { label: "Rain now", value: `${current.precipitation ?? 0} ${labels.precipitation}` },
    { label: "Cloud cover", value: `${current.cloudCover ?? 0}%` },
  ]
    .map(
      (metric) => `
        <div class="metric">
          <dt>${metric.label}</dt>
          <dd>${escapeHtml(metric.value)}${metric.note ? ` <small>${escapeHtml(metric.note)}</small>` : ""}</dd>
        </div>`,
    )
    .join("");

  const isLive = location.source === "live";
  const sourceLabel = isLive ? "live · Open-Meteo" : "offline sample";
  const sourceTitle = isLive
    ? "Live weather from Open-Meteo"
    : `Locally generated sample${location.fallbackReason ? ` · ${location.fallbackReason}` : ""}`;

  return `
    <article class="card" data-tone="${current.condition.tone}" data-id="${location.id}">
      <div class="card-head">
        <div class="place">
          <h2>${city}${location.isDefault ? '<span class="default-badge">default</span>' : ""}</h2>
          ${place ? `<p>${place}</p>` : ""}
        </div>
        <div class="card-actions">
          <button
            type="button"
            class="icon-btn star${location.isDefault ? " is-on" : ""}"
            data-action="default"
            data-id="${location.id}"
            aria-pressed="${location.isDefault}"
            aria-label="${location.isDefault ? `${city} is the default city` : `Make ${city} the default city`}"
            title="${location.isDefault ? "Default city" : "Make default"}"
          >${STAR_ICON}</button>
          <button
            type="button"
            class="icon-btn danger"
            data-action="remove"
            data-id="${location.id}"
            aria-label="Remove ${city}"
            title="Remove ${city}"
          >${CROSS_ICON}</button>
        </div>
      </div>

      <div class="now">
        <div class="now-main">
          <div class="temp" aria-label="${current.temperature} degrees ${labels.temperature}">
            ${current.temperature}<span class="deg">°</span>
          </div>
          <div class="cond">
            ${iconMarkup(current.condition.icon)}
            <span>${escapeHtml(current.condition.label)}</span>
          </div>
          <p class="range"><b>H ${highLow}°</b> · L ${lowLow}° · ${current.precipitationChance}% rain</p>
        </div>
        <div class="now-icon">${iconMarkup(current.condition.icon)}</div>
      </div>

      <dl class="metrics">${metrics}</dl>

      <div class="sun">
        <div class="sun-item">
          <span class="ic" aria-hidden="true">${SUNRISE_ICON}</span>
          <span><strong>${sunrise}</strong>sunrise</span>
        </div>
        <div class="sun-item">
          <span class="ic" aria-hidden="true">${SUNSET_ICON}</span>
          <span><strong>${sunset}</strong>sunset</span>
        </div>
      </div>

      <div class="forecast">
        <div class="forecast-head">
          <span>Next ${location.forecast.length} days</span>
          <span>${location.sun.daylightHours} h daylight</span>
        </div>
        <ul class="days">${days}</ul>
      </div>

      <div class="card-foot">
        <span data-updated="${escapeHtml(location.updatedAt)}">Updated ${relativeTime(location.updatedAt)}</span>
        <span class="engine ${isLive ? "live" : "sample"}" title="${escapeHtml(sourceTitle)}">${sourceLabel}</span>
      </div>
    </article>`;
}

function updateTimestamps() {
  for (const element of document.querySelectorAll("[data-updated]")) {
    element.textContent = `Updated ${relativeTime(element.dataset.updated)}`;
  }
  updateStatus();
}

function updateStatus() {
  if (!state.loaded) {
    els.status.textContent = "Connecting…";
    return;
  }
  const count = state.locations.length;
  const liveCount = state.locations.filter((location) => location.source === "live").length;
  const units = state.units === "imperial" ? "imperial" : "metric";
  const stamp = state.lastLoadedAt
    ? relativeTime(new Date(state.lastLoadedAt).toISOString())
    : "just now";
  const source = count === 0
    ? ""
    : liveCount === count
      ? " · live"
      : ` · ${liveCount}/${count} live`;
  els.status.textContent = `${count} ${count === 1 ? "city" : "cities"} · ${units}${source} · updated ${stamp}`;
}

function renderUnitToggle() {
  for (const button of els.segments) {
    button.setAttribute("aria-pressed", String(button.dataset.units === state.units));
  }
}

function renderMap() {
  const pinned = state.locations.filter(
    (location) => Number.isFinite(location.latitude) && Number.isFinite(location.longitude),
  );

  if (state.loading) {
    els.mapPanel.hidden = true;
    els.mapPins.innerHTML = "";
    return;
  }

  els.mapPanel.hidden = false;

  if (pinned.length === 0) {
    els.mapPins.innerHTML = "";
    els.mapStatus.textContent = "No places pinned yet — search for a city above";
    return;
  }

  els.mapPins.innerHTML = pinned
    .map((location) => {
      const left = Math.min(99.5, Math.max(0.5, ((location.longitude + 180) / 360) * 100));
      const top = Math.min(99.5, Math.max(0.5, ((90 - location.latitude) / 180) * 100));
      const temp = `${Math.round(location.current.temperature)}°`;
      const detail = `${location.city} · ${location.current.temperature}${location.unitLabels.temperature} · ${location.current.condition.label}`;
      return `
        <button
          type="button"
          class="map-pin"
          style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%"
          data-map-id="${location.id}"
          data-tone="${location.current.condition.tone}"
          aria-label="${escapeHtml(detail)}"
          title="${escapeHtml(detail)}"
        >
          <span class="map-pin-temp">${temp}</span>
          <span class="map-pin-name">${escapeHtml(location.city)}</span>
        </button>`;
    })
    .join("");

  els.mapStatus.textContent = `${pinned.length} ${pinned.length === 1 ? "place" : "places"} pinned · Natural Earth`;
}

function render() {
  renderUnitToggle();

  const tone = state.locations[0]?.current?.condition?.tone ?? "clear";
  document.body.dataset.tone = tone;

  const hasLocations = state.locations.length > 0;

  els.skeletons.hidden = !state.loading;
  els.dashboard.hidden = state.loading || !hasLocations;
  els.empty.hidden = state.loading || hasLocations;
  els.welcomeName.textContent = firstName(state.user?.name);

  if (!state.loading && hasLocations) {
    els.dashboard.innerHTML = state.locations.map(cardHtml).join("");
  }

  renderMap();
  updateTimestamps();
}

function applyPayload(data) {
  state.units = data.units ?? state.units;
  state.unitLabels = data.unitLabels ?? state.unitLabels;
  state.settings = data.settings ?? state.settings;
  state.locations = Array.isArray(data.locations) ? data.locations : [];
  state.loaded = true;
  state.loading = false;
  state.lastLoadedAt = Date.now();
  render();
}

/* -------------------------------- actions ------------------------------- */

async function load({ quiet = false } = {}) {
  if (!quiet) {
    state.loading = true;
    render();
  }

  try {
    const data = await api(`/api/weather?units=${encodeURIComponent(state.units)}`);
    hideBanner();
    applyPayload(data);
  } catch (error) {
    state.loading = false;
    render();
    showBanner(error.message);
  }
}

async function refreshAll() {
  if (state.refreshing) return;
  state.refreshing = true;
  els.refresh.classList.add("is-busy");
  els.refresh.setAttribute("aria-busy", "true");

  try {
    const data = await api(`/api/weather/refresh?units=${encodeURIComponent(state.units)}`, {
      method: "POST",
    });
    hideBanner();
    applyPayload(data);
    showToast("Fresh readings generated");
  } catch (error) {
    showBanner(error.message);
  } finally {
    state.refreshing = false;
    els.refresh.classList.remove("is-busy");
    els.refresh.removeAttribute("aria-busy");
  }
}

async function changeUnits(units) {    if (units === state.units) return;
  const previous = state.units;
  state.units = units;
  renderUnitToggle();

  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ units }),
    });
    await load({ quiet: true });
  } catch (error) {
    state.units = previous;
    renderUnitToggle();
    showBanner(error.message);
  }
}

async function addCity(city, place) {
  const button = els.form.querySelector('button[type="submit"]');
  const originalLabel = button.textContent;

  button.disabled = true;
  button.textContent = "Adding…";

  try {
    await api("/api/locations", {
      method: "POST",
      body: JSON.stringify(place ? { city, place } : { city }),
    });
    els.city.value = "";
    state.selectedPlace = null;
    closePlaceResults();
    clearFormError();
    await load({ quiet: true });
    showToast(`Added ${city}`);
  } catch (error) {
    showFormError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function removeSaved(id) {
  const location = state.locations.find((entry) => entry.id === id);
  if (!location) return;

  try {
    await api(`/api/locations/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.locations = state.locations.filter((entry) => entry.id !== id);
    if (state.settings?.defaultLocationId === id) {
      state.settings.defaultLocationId = state.locations[0]?.id ?? null;
    }
    render();
    showToast(`Removed ${location.city}`);
  } catch (error) {
    showBanner(error.message);
  }
}

async function makeDefault(id) {
  const location = state.locations.find((entry) => entry.id === id);
  if (!location || location.isDefault) return;

  try {
    await api(`/api/locations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ isDefault: true }),
    });
    state.settings = { ...(state.settings ?? {}), defaultLocationId: id };
    state.locations = state.locations
      .map((entry) => ({ ...entry, isDefault: entry.id === id }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    render();
    showToast(`${location.city} is now your default`);
  } catch (error) {
    showBanner(error.message);
  }
}

/* -------------------------------- events -------------------------------- */

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearFormError();

  const typed = els.city.value.trim();
  const selected =
    state.selectedPlace && typed === state.selectedPlace.label ? state.selectedPlace : null;
  const city = selected ? selected.name : typed;

  if (!city) {
    showFormError("Search for a city or town first.");
    els.city.focus();
    return;
  }

  addCity(city, selected ?? undefined);
});

els.city.addEventListener("input", () => {
  clearFormError();
  schedulePlaceSearch();
});

els.city.addEventListener("keydown", (event) => {
  if (els.placeResults.hidden || state.places.length === 0) {
    if (event.key === "Escape") {
      state.selectedPlace = null;
    }
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const count = state.places.length;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    state.placeIndex = (state.placeIndex + direction + count) % count;
    renderPlaceResults();
    els.placeResults.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && state.placeIndex >= 0) {
    event.preventDefault();
    choosePlace(state.placeIndex);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closePlaceResults();
  }
});

els.placeResults.addEventListener("mousedown", (event) => {
  const item = event.target.closest("li[data-index]");
  if (!item) return;
  event.preventDefault();
  choosePlace(Number(item.dataset.index));
});

els.city.addEventListener("blur", () => {
  setTimeout(closePlaceResults, 120);
});

document.addEventListener("click", (event) => {
  if (!els.form.contains(event.target)) closePlaceResults();
});

els.refresh.addEventListener("click", refreshAll);

if (els.themeToggle) {
  els.themeToggle.addEventListener("click", () => {
    applyTheme(currentTheme() === "light" ? "dark" : "light");
  });
}

els.emptyCta.addEventListener("click", () => {
  els.city.focus();
});

for (const button of els.segments) {
  button.addEventListener("click", () => changeUnits(button.dataset.units));
}

els.dashboard.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  if (action === "remove") removeSaved(id);
  if (action === "default") makeDefault(id);
});

els.mapPins.addEventListener("click", (event) => {
  const pin = event.target.closest("[data-map-id]");
  if (!pin) return;

  const card = document.querySelector(`.card[data-id="${CSS.escape(pin.dataset.mapId)}"]`);
  if (!card) return;

  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("is-highlighted");
  window.setTimeout(() => card.classList.remove("is-highlighted"), 1600);
});

els.banner.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry]")) load();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.loaded && Date.now() - state.lastLoadedAt > AUTO_REFRESH_AFTER_MS) {
    load({ quiet: true });
  }
});

/* ---------------------------------- boot -------------------------------- */

function renderSkeletons() {
  els.skeletons.innerHTML = Array.from({ length: 3 }, () => '<div class="skeleton"></div>').join("");
}

function renderAccount() {
  if (!state.user) {
    els.accountLine.hidden = true;
    return;
  }
  els.accountName.textContent = state.user.name;
  els.accountLine.hidden = false;
}

async function boot() {
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
    renderAccount();
    await load();

    const params = new URLSearchParams(location.search);
    if (params.get("welcome") === "1") {
      showToast(`Welcome, ${firstName(user.name)}. Your earlier cities are here.`);
      params.delete("welcome");
      const query = params.toString();
      history.replaceState({}, "", `${location.pathname}${query ? `?${query}` : ""}`);
    }
  } catch {
    // api() sends missing or expired sessions to /signin.
  }
}

els.signout.addEventListener("click", async () => {
  els.signout.disabled = true;
  try {
    await api("/api/auth/signout", { method: "POST" });
  } catch {
    // Either way, the next stop is the sign-in page.
  }
  location.replace("/signin");
});

applyTheme(currentTheme(), { persist: false });
renderSkeletons();
renderUnitToggle();
renderAccount();
render();
boot();

setInterval(updateTimestamps, 30_000);
setInterval(() => {
  if (state.loaded && !document.hidden && Date.now() - state.lastLoadedAt > AUTO_REFRESH_AFTER_MS) {
    load({ quiet: true });
  }
}, 60_000);
