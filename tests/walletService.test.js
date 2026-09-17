// fake-indexeddb polyfills globalThis.indexedDB so Dexie can run for real
// under Vitest's jsdom environment (which has no native IndexedDB). Must be
// the first import — everything below assumes indexedDB already exists.
import 'fake-indexeddb/auto';

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/dexie.js';
import {
  addExchange,
  addExpense,
  listExchanges,
  listExpenses,
  getWalletSummary,
} from '../src/services/walletService.js';

const TRIP_ID = 1;

async function makeCategory(name = 'Food') {
  return db.categories.add({
    tripId: TRIP_ID,
    name,
    icon: '🍽',
    parentId: null,
    isDefault: false,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
  });
}

beforeEach(async () => {
  // Fresh wallet state for every test — addExchange/addExpense read
  // "all exchanges for this trip", so leftover rows from a previous test
  // would silently change a weighted average or a snapshot.
  await db.exchanges.clear();
  await db.transactions.clear();
  await db.categories.clear();
});

describe('addExchange — single exchange', () => {
  it('computes and stores the acquisition rate', async () => {
    const ex = await addExchange(TRIP_ID, {
      pkrGiven: '50000', sarReceived: '667.56', date: '2026-09-25',
    });
    expect(ex.id).toBeDefined();
    expect(ex.acquisitionRate).toBe('74.899634');
    expect(ex.pkrGiven).toBe('50000.00');
    expect(ex.sarReceived).toBe('667.56');
  });

  it('persists to Dexie — a fresh read returns the same record', async () => {
    const created = await addExchange(TRIP_ID, {
      pkrGiven: '50000', sarReceived: '667.56', date: '2026-09-25', location: 'Karachi',
    });
    const fromDb = await db.exchanges.get(created.id);
    expect(fromDb.acquisitionRate).toBe('74.899634');
    expect(fromDb.location).toBe('Karachi');
  });
});

describe('addExchange — multiple exchanges and weighted average', () => {
  it('getWalletSummary computes the weighted average, not an arithmetic mean of rates', async () => {
    // Matches the worked example from the architecture doc.
    await addExchange(TRIP_ID, { pkrGiven: '50000', sarReceived: '667.56', date: '2026-09-25' });
    await addExchange(TRIP_ID, { pkrGiven: '30000', sarReceived: '397.35', date: '2026-10-01' });

    const summary = await getWalletSummary(TRIP_ID);
    expect(summary.totalPkrInvested).toBe('80000.00');
    expect(summary.totalSarAcquired).toBe('1064.91');
    // (50000+30000) / (667.56+397.35) = 75.123719 — NOT the arithmetic mean
    // of the two individual rates (74.899634 + 75.499685...) / 2.
    expect(summary.weightedRate).toBe('75.123719');
  });

  it('three exchanges still weight by SAR volume, not by count', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '50000', sarReceived: '667.56', date: '2026-09-25' });
    await addExchange(TRIP_ID, { pkrGiven: '30000', sarReceived: '397.35', date: '2026-10-01' });
    await addExchange(TRIP_ID, { pkrGiven: '20000', sarReceived: '263.85', date: '2026-10-15' });

    const summary = await getWalletSummary(TRIP_ID);
    expect(summary.totalPkrInvested).toBe('100000.00');
    expect(summary.weightedRate).toBe('75.258135');
  });
});

describe('addExchange — zero/invalid input', () => {
  it('rejects zero sarReceived', async () => {
    await expect(addExchange(TRIP_ID, {
      pkrGiven: '100', sarReceived: '0', date: '2026-09-25',
    })).rejects.toThrow(/sarReceived/);
  });

  it('rejects negative sarReceived', async () => {
    await expect(addExchange(TRIP_ID, {
      pkrGiven: '100', sarReceived: '-5', date: '2026-09-25',
    })).rejects.toThrow(/sarReceived/);
  });

  it('rejects zero pkrGiven', async () => {
    await expect(addExchange(TRIP_ID, {
      pkrGiven: '0', sarReceived: '10', date: '2026-09-25',
    })).rejects.toThrow(/pkrGiven/);
  });

  it('rejects negative pkrGiven', async () => {
    await expect(addExchange(TRIP_ID, {
      pkrGiven: '-100', sarReceived: '10', date: '2026-09-25',
    })).rejects.toThrow(/pkrGiven/);
  });

  it('rejects a non-numeric amount', async () => {
    await expect(addExchange(TRIP_ID, {
      pkrGiven: 'not-a-number', sarReceived: '10', date: '2026-09-25',
    })).rejects.toThrow();
  });

  it('does not write a row to Dexie when validation fails', async () => {
    await expect(addExchange(TRIP_ID, {
      pkrGiven: '100', sarReceived: '0', date: '2026-09-25',
    })).rejects.toThrow();
    expect(await db.exchanges.count()).toBe(0);
  });
});

describe('addExchange — rounding boundaries', () => {
  // Same boundary cases that exposed and then verified the backend's
  // acquisition_rate precision fix — reused here to confirm the frontend
  // agrees with calcAcquisitionRate() exactly through the Dexie write path.
  const BOUNDARY_CASES = [
    ['1234565', '10000000', '0.123457'],
    ['987655', '10000000', '0.098766'],
    ['123', '400000', '0.000308'],
    ['4999995', '10000000', '0.500000'],
  ];

  it.each(BOUNDARY_CASES)('pkrGiven=%s sarReceived=%s -> %s', async (pkrGiven, sarReceived, expected) => {
    const ex = await addExchange(TRIP_ID, { pkrGiven, sarReceived, date: '2026-09-25' });
    expect(ex.acquisitionRate).toBe(expected);
  });
});

describe('addExpense — expense deduction and wallet balance', () => {
  it('an expense reduces the wallet balance by its SAR amount', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    const categoryId = await makeCategory();

    await addExpense(TRIP_ID, {
      amountSar: '150', categoryId, date: '2026-09-26', location: 'Makkah',
    });

    const summary = await getWalletSummary(TRIP_ID);
    expect(summary.totalSarAcquired).toBe('1000.00');
    expect(summary.totalSarSpent).toBe('150.00');
    expect(summary.sarBalance).toBe('850.00');
  });

  it('a REFUND increases the balance back', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    const categoryId = await makeCategory();

    await addExpense(TRIP_ID, { amountSar: '150', categoryId, date: '2026-09-26' });
    await addExpense(TRIP_ID, { amountSar: '50', type: 'REFUND', categoryId, date: '2026-09-27' });

    const summary = await getWalletSummary(TRIP_ID);
    expect(summary.totalSarSpent).toBe('100.00'); // 150 - 50
    expect(summary.sarBalance).toBe('900.00');
  });

  it('multiple expenses all deduct correctly', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    const categoryId = await makeCategory();

    await addExpense(TRIP_ID, { amountSar: '35.50', categoryId, date: '2026-09-26' });
    await addExpense(TRIP_ID, { amountSar: '120.25', categoryId, date: '2026-09-27' });
    await addExpense(TRIP_ID, { amountSar: '10.00', categoryId, date: '2026-09-28' });

    const expenses = await listExpenses(TRIP_ID);
    expect(expenses).toHaveLength(3);

    const summary = await getWalletSummary(TRIP_ID);
    expect(summary.totalSarSpent).toBe('165.75');
    expect(summary.sarBalance).toBe('834.25');
  });

  it('balance can go negative if overspent', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '7490', sarReceived: '100', date: '2026-09-25' });
    const categoryId = await makeCategory();
    await addExpense(TRIP_ID, { amountSar: '150', categoryId, date: '2026-09-26' });

    const summary = await getWalletSummary(TRIP_ID);
    expect(summary.sarBalance).toBe('-50.00');
  });
});

describe('addExpense — zero/invalid input', () => {
  it('rejects zero amountSar even with no exchanges recorded yet', async () => {
    const categoryId = await makeCategory();
    await expect(addExpense(TRIP_ID, {
      amountSar: '0', categoryId, date: '2026-09-26',
    })).rejects.toThrow(/amountSar/);
  });

  it('rejects negative amountSar', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    const categoryId = await makeCategory();
    await expect(addExpense(TRIP_ID, {
      amountSar: '-10', categoryId, date: '2026-09-26',
    })).rejects.toThrow(/amountSar/);
  });

  it('rejects a missing categoryId', async () => {
    await expect(addExpense(TRIP_ID, {
      amountSar: '10', date: '2026-09-26',
    })).rejects.toThrow(/categoryId/);
  });

  it('rejects an invalid type', async () => {
    const categoryId = await makeCategory();
    await expect(addExpense(TRIP_ID, {
      amountSar: '10', categoryId, date: '2026-09-26', type: 'TRANSFER',
    })).rejects.toThrow(/type/);
  });

  it('does not write a row to Dexie when validation fails', async () => {
    const categoryId = await makeCategory();
    await expect(addExpense(TRIP_ID, {
      amountSar: '-10', categoryId, date: '2026-09-26',
    })).rejects.toThrow();
    expect(await db.transactions.count()).toBe(0);
  });
});

describe('Historical snapshot immutability', () => {
  it('an expense keeps its original pkrEquivalent/acquisitionRateUsed after a new exchange changes the weighted average', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    const categoryId = await makeCategory();

    const expense = await addExpense(TRIP_ID, {
      amountSar: '50', categoryId, date: '2026-09-26',
    });
    expect(expense.acquisitionRateUsed).toBe('74.900000');
    expect(expense.pkrEquivalent).toBe('3745.00');

    // A very different exchange arrives later, shifting the weighted average a lot.
    await addExchange(TRIP_ID, { pkrGiven: '100000', sarReceived: '1000', date: '2026-10-15' });
    const newSummary = await getWalletSummary(TRIP_ID);
    expect(newSummary.weightedRate).not.toBe('74.900000');

    // The earlier expense must be untouched.
    const refetched = await db.transactions.get(expense.id);
    expect(refetched.acquisitionRateUsed).toBe('74.900000');
    expect(refetched.pkrEquivalent).toBe('3745.00');
  });

  it('an expense recorded before any exchange exists snapshots zero, and stays zero', async () => {
    const categoryId = await makeCategory();
    const expense = await addExpense(TRIP_ID, { amountSar: '20', categoryId, date: '2026-09-26' });
    expect(expense.pkrEquivalent).toBe('0.00');
    expect(expense.acquisitionRateUsed).toBe('0.000000');

    await addExchange(TRIP_ID, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-27' });

    const refetched = await db.transactions.get(expense.id);
    expect(refetched.pkrEquivalent).toBe('0.00');
    expect(refetched.acquisitionRateUsed).toBe('0.000000');
  });

  it('multiple expenses each keep the rate that was current when THEY were created', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    const categoryId = await makeCategory();

    const first = await addExpense(TRIP_ID, { amountSar: '10', categoryId, date: '2026-09-26' });
    expect(first.acquisitionRateUsed).toBe('74.900000');

    await addExchange(TRIP_ID, { pkrGiven: '100000', sarReceived: '1000', date: '2026-10-01' });

    const second = await addExpense(TRIP_ID, { amountSar: '10', categoryId, date: '2026-10-02' });
    // Second expense correctly picks up the NEW weighted average...
    expect(second.acquisitionRateUsed).toBe('87.450000'); // (74900+100000)/2000

    // ...while the first one is still exactly what it was.
    const firstRefetched = await db.transactions.get(first.id);
    expect(firstRefetched.acquisitionRateUsed).toBe('74.900000');
  });
});

describe('getWalletSummary — balance after exchange + expenses combined', () => {
  it('reflects exchanges and expenses together correctly', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '50000', sarReceived: '667.56', date: '2026-09-25' });
    await addExchange(TRIP_ID, { pkrGiven: '30000', sarReceived: '397.35', date: '2026-10-01' });
    const categoryId = await makeCategory();

    await addExpense(TRIP_ID, { amountSar: '35.00', categoryId, date: '2026-09-26' });
    await addExpense(TRIP_ID, { amountSar: '120.55', categoryId, date: '2026-09-27' });
    await addExpense(TRIP_ID, { amountSar: '10.10', type: 'REFUND', categoryId, date: '2026-09-28' });

    const summary = await getWalletSummary(TRIP_ID);
    expect(summary.totalSarAcquired).toBe('1064.91');
    expect(summary.totalSarSpent).toBe('145.45'); // 35.00 + 120.55 - 10.10
    expect(summary.sarBalance).toBe('919.46');
    expect(summary.weightedRate).toBe('75.123719');
    expect(summary.exchangeCount).toBe(2);
    expect(summary.transactionCount).toBe(3);
  });

  it('returns an all-zero summary for a trip with nothing recorded yet', async () => {
    const summary = await getWalletSummary(TRIP_ID);
    expect(summary.totalSarAcquired).toBe('0.00');
    expect(summary.totalSarSpent).toBe('0.00');
    expect(summary.sarBalance).toBe('0.00');
    expect(summary.exchangeCount).toBe(0);
    expect(summary.transactionCount).toBe(0);
  });

  it('keeps trips isolated from one another', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '74900', sarReceived: '1000', date: '2026-09-25' });
    await addExchange(2, { pkrGiven: '10000', sarReceived: '100', date: '2026-01-01' });

    const summaryTrip1 = await getWalletSummary(TRIP_ID);
    const summaryTrip2 = await getWalletSummary(2);
    expect(summaryTrip1.totalSarAcquired).toBe('1000.00');
    expect(summaryTrip2.totalSarAcquired).toBe('100.00');
  });
});

describe('listExchanges / listExpenses', () => {
  it('return only the requested trip’s records, sorted by date', async () => {
    await addExchange(TRIP_ID, { pkrGiven: '30000', sarReceived: '400', date: '2026-10-01' });
    await addExchange(TRIP_ID, { pkrGiven: '50000', sarReceived: '667.56', date: '2026-09-25' });

    const exchanges = await listExchanges(TRIP_ID);
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].date).toBe('2026-09-25');
    expect(exchanges[1].date).toBe('2026-10-01');
  });
});
