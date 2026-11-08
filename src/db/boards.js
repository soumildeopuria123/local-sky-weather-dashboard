/** One dashboard JSON file per account, cached in memory. */

import { access } from 'node:fs/promises';
import path from 'node:path';

import { JsonStore } from './store.js';

export class BoardStore {
  constructor({ directory, legacyStore = null }) {
    this.directory = directory;
    this.legacyStore = legacyStore;
    this.boards = new Map();
  }

  fileNameFor(userId) {
    const safeId = String(userId).replace(/[^A-Za-z0-9_-]/g, '_');
    return path.join(this.directory, `${safeId}.json`);
  }

  async get(userId) {
    if (this.boards.has(userId)) return this.boards.get(userId);

    const board = await new JsonStore(this.fileNameFor(userId)).init();
    this.boards.set(userId, board);
    return board;
  }

  /**
   * The dashboard predates accounts, so the first account to sign up keeps the
   * cities that were already saved in data/weather.json.
   */
  async seedFromLegacy(userId) {
    if (!this.legacyStore) return false;

    const file = this.fileNameFor(userId);
    try {
      await access(file);
      return false;
    } catch {
      // No board yet; it is safe to copy the legacy dashboard.
    }

    const legacy = this.legacyStore.getState();
    if (!Array.isArray(legacy.locations) || legacy.locations.length === 0) return false;

    const board = await this.get(userId);
    await board.update((state) => {
      state.locations = structuredClone(legacy.locations);
      state.settings = structuredClone(legacy.settings);
    });
    return true;
  }
}
