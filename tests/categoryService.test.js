import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/dexie.js';
import { addCategory, updateCategory, deleteCategory } from '../src/services/walletService.js';
import { ensureAppData } from '../src/services/appDataService.js';

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

describe('Category Management', () => {
  let tripId;

  beforeEach(async () => {
    await clearDatabase();
    const data = await ensureAppData();
    tripId = data.trip.id;
  });

  it('can add a new category', async () => {
    const cat = await addCategory(tripId, 'Gifts', '🎁');
    expect(cat.id).toBeDefined();
    expect(cat.name).toBe('Gifts');
    expect(cat.icon).toBe('🎁');
    expect(cat.isDefault).toBe(false);
    const saved = await db.categories.get(cat.id);
    expect(saved.name).toBe('Gifts');
  });

  it('can update a category name and icon', async () => {
    const cat = await addCategory(tripId, 'Gifts', '🎁');
    const updated = await updateCategory(cat.id, { name: 'Presents', icon: '🎀' });
    expect(updated.name).toBe('Presents');
    expect(updated.icon).toBe('🎀');
  });

  it('cannot delete a default category', async () => {
    // Use filter() because IDB doesn't support boolean keys in range queries
    const defaults = await db.categories.filter(c => c.isDefault === true).toArray();
    expect(defaults.length).toBeGreaterThan(0);
    await expect(deleteCategory(defaults[0].id)).rejects.toThrow(/default/);
  });

  it('can delete an unused custom category', async () => {
    const cat = await addCategory(tripId, 'Temp', '❓');
    expect(await db.categories.get(cat.id)).toBeDefined();
    await deleteCategory(cat.id);
    expect(await db.categories.get(cat.id)).toBeUndefined();
  });

  it('cannot delete a category in use by transactions', async () => {
    const cat = await addCategory(tripId, 'Used', '🔒');
    await db.transactions.add({
      tripId,
      categoryId: cat.id,
      amountSar: '10.00',
      pkrEquivalent: '750.00',
      acquisitionRateUsed: '75.000000',
      date: '2026-10-01',
      createdAt: new Date().toISOString(),
    });
    await expect(deleteCategory(cat.id)).rejects.toThrow(/in use/);
  });

  it('throws on add without name', async () => {
    await expect(addCategory(tripId, '', '📦')).rejects.toThrow(/name/);
  });
});
