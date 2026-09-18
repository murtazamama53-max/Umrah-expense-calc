import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/dexie.js';
import { DEFAULT_CATEGORIES, DEFAULT_TRIP, ensureAppData } from '../src/services/appDataService.js';

async function clearDatabase() {
  await db.open();
  await Promise.all([
    db.trips.clear(),
    db.exchanges.clear(),
    db.transactions.clear(),
    db.categories.clear(),
    db.shoppingItems.clear(),
    db.rateSnapshots.clear(),
    db.syncQueue.clear(),
  ]);
}

beforeEach(async () => {
  await clearDatabase();
});

describe('ensureAppData', () => {
  it('creates the Umrah trip and default categories without fake financial rows', async () => {
    const { trip, categories } = await ensureAppData();

    expect(trip.name).toBe(DEFAULT_TRIP.name);
    expect(trip.startDate).toBe('2026-09-25');
    expect(trip.endDate).toBe('2026-11-15');
    expect(categories.map((category) => category.name)).toEqual(
      DEFAULT_CATEGORIES.map((category) => category.name),
    );
    expect(await db.exchanges.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });

  it('is idempotent when called repeatedly', async () => {
    await ensureAppData();
    await ensureAppData();

    expect(await db.trips.count()).toBe(1);
    expect(await db.categories.count()).toBe(DEFAULT_CATEGORIES.length);
  });
});
