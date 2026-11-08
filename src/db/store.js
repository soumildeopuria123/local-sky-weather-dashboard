/**
 * A tiny JSON-file store with atomic writes and serialized updates.
 * No database server, no ORM: the whole dashboard state lives in one file
 * that is easy to read, back up and inspect.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
      .filter((location) => location && typeof location.id === 'string' && typeof location.city === 'string')
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
        reading: location.reading && typeof location.reading === 'object' ? location.reading : null,
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

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = DEFAULT_STATE();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.state = normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(
          `[store] Could not read ${this.filePath} (${error.message}). Starting with an empty dashboard.`,
        );
        await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => {});
      }
      this.state = DEFAULT_STATE();
      await this.persist();
    }

    return this;
  }

  getState() {
    return this.state;
  }

  /**
   * Runs a mutation against a copy of the state, then persists atomically.
   * Updates are serialized so simultaneous requests can't clobber each other.
   */
  update(mutator) {
    const run = this.writeQueue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = normalizeState(draft);
      await this.persist();
      return result;
    });

    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  async persist() {
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, payload, 'utf8');
    await rename(temporary, this.filePath);
  }
}
