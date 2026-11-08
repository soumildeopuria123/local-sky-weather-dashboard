/** Per-account dashboards stored as JSON in D1, with the same shape as local data. */

const DEFAULT_STATE = () => ({
  version: 1,
  settings: {
    units: 'metric',
    defaultLocationId: null,
  },
  locations: [],
});

function normalizeState(raw) {
  const state = DEFAULT_STATE();
  if (!raw || typeof raw !== 'object') return state;

  if (raw.settings && typeof raw.settings === 'object') {
    state.settings.units = raw.settings.units === 'imperial' ? 'imperial' : 'metric';
    state.settings.defaultLocationId =
      typeof raw.settings.defaultLocationId === 'string'
        ? raw.settings.defaultLocationId
        : null;
  }

  if (Array.isArray(raw.locations)) {
    state.locations = raw.locations
      .filter(
        (location) =>
          location && typeof location.id === 'string' && typeof location.city === 'string',
      )
      .map((location) => ({
        id: location.id,
        city: location.city,
        region: location.region ?? null,
        country: location.country ?? null,
        timezone: location.timezone ?? null,
        profileKey: location.profileKey ?? null,
        geocoded: location.geocoded === true,
        latitude: Number.isFinite(location.latitude) ? location.latitude : null,
        longitude: Number.isFinite(location.longitude) ? location.longitude : null,
        createdAt: location.createdAt ?? new Date().toISOString(),
        revision: Number.isInteger(location.revision) ? location.revision : 0,
        reading:
          location.reading && typeof location.reading === 'object' ? location.reading : null,
      }));
  }

  if (
    state.settings.defaultLocationId &&
    !state.locations.some((location) => location.id === state.settings.defaultLocationId)
  ) {
    state.settings.defaultLocationId = null;
  }

  return state;
}

function parseState(value) {
  try {
    return normalizeState(JSON.parse(value));
  } catch {
    return DEFAULT_STATE();
  }
}

const boardsByDb = new WeakMap();

export async function openBoard(db, userId) {
  let boards = boardsByDb.get(db);
  if (!boards) {
    boards = new Map();
    boardsByDb.set(db, boards);
  }

  const cached = boards.get(userId);
  if (cached) return cached;

  const row = await db
    .prepare('SELECT state FROM boards WHERE user_id = ?')
    .bind(userId)
    .first();

  let state;
  if (row) {
    state = parseState(row.state);
  } else {
    state = DEFAULT_STATE();
    await db
      .prepare('INSERT INTO boards (user_id, state, updated_at) VALUES (?, ?, ?)')
      .bind(userId, JSON.stringify(state), new Date().toISOString())
      .run();
  }

  const board = new Board(db, userId, state);
  boards.set(userId, board);
  return board;
}

class Board {
  constructor(db, userId, state) {
    this.db = db;
    this.userId = userId;
    this.state = state;
    this.queue = Promise.resolve();
  }

  getState() {
    return this.state;
  }

  update(mutator) {
    const run = this.queue.then(async () => {
      const row = await this.db
        .prepare('SELECT state FROM boards WHERE user_id = ?')
        .bind(this.userId)
        .first();

      const base = row ? parseState(row.state) : this.state;
      const draft = structuredClone(base);
      const result = await mutator(draft);
      const next = normalizeState(draft);

      await this.db
        .prepare('UPDATE boards SET state = ?, updated_at = ? WHERE user_id = ?')
        .bind(JSON.stringify(next), new Date().toISOString(), this.userId)
        .run();

      this.state = next;
      return result;
    });

    this.queue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }
}
