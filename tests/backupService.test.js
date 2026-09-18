import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/dexie.js';
import { addExchange, addExpense } from '../src/services/walletService.js';
import { exportBackupData, importBackupData } from '../src/services/backupService.js';
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

describe('Backup / Restore', () => {
  let tripId, categoryId;

  beforeEach(async () => {
    await clearDatabase();
    const { trip, categories } = await ensureAppData();
    tripId = trip.id;
    categoryId = categories[0].id;
  });

  it('exportBackupData includes all required tables', async () => {
    const json = await exportBackupData();
    const data = JSON.parse(json);
    expect(data.trips).toBeInstanceOf(Array);
    expect(data.exchanges).toBeInstanceOf(Array);
    expect(data.transactions).toBeInstanceOf(Array);
    expect(data.categories).toBeInstanceOf(Array);
  });

  it('exportBackupData preserves pkrEquivalent and acquisitionRateUsed on transactions', async () => {
    await addExchange(tripId, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    await addExpense(tripId, { amountSar: '100', categoryId, date: '2026-09-26', note: 'Test' });

    const json = await exportBackupData();
    const data = JSON.parse(json);

    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0].pkrEquivalent).toBeDefined();
    expect(data.transactions[0].acquisitionRateUsed).toBeDefined();
  });

  it('importBackupData restores all data correctly', async () => {
    await addExchange(tripId, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    await addExpense(tripId, { amountSar: '100', categoryId, date: '2026-09-26', note: 'Dinner' });

    const json = await exportBackupData();

    // Wipe everything
    await clearDatabase();

    expect(await db.trips.count()).toBe(0);
    expect(await db.exchanges.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);

    // Restore
    await importBackupData(json);

    expect(await db.trips.count()).toBeGreaterThan(0);
    expect(await db.exchanges.count()).toBe(1);
    expect(await db.transactions.count()).toBe(1);
  });

  it('importBackupData preserves historical pkrEquivalent after restore', async () => {
    await addExchange(tripId, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    const expense = await addExpense(tripId, { amountSar: '100', categoryId, date: '2026-09-26', note: 'Dinner' });
    const originalPkr = expense.pkrEquivalent;
    const originalRate = expense.acquisitionRateUsed;

    const json = await exportBackupData();
    await clearDatabase();
    await importBackupData(json);

    const restored = await db.transactions.toCollection().first();
    expect(restored.pkrEquivalent).toBe(originalPkr);
    expect(restored.acquisitionRateUsed).toBe(originalRate);
  });

  it('importBackupData rejects invalid JSON', async () => {
    await expect(importBackupData('not json at all')).rejects.toThrow(/Invalid JSON/);
  });

  it('importBackupData rejects structurally invalid backup', async () => {
    const bad = JSON.stringify({ trips: [], exchanges: [] }); // missing transactions + categories
    await expect(importBackupData(bad)).rejects.toThrow(/Invalid backup file/);
  });
});
