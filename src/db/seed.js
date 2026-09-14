/**
 * UMRAH WALLET — Database Seed
 *
 * Seeds the local IndexedDB with:
 *   - One trip record (Umrah 2026)
 *   - Default categories and subcategories
 *   - 3 exchange transactions (demonstrating weighted average)
 *   - 10 sample expense transactions
 *
 * IMPORTANT: This seed function is idempotent — it checks if data already
 * exists before inserting. Safe to call on every app startup in dev mode.
 * In production, it only runs if the trips table is empty.
 */

import Decimal from 'decimal.js';
import db from './dexie.js';
import { calcAcquisitionRate, calcWeightedAvgRate } from '../services/exchangeService.js';

// ── Default Categories ─────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  { name: 'Food & Drinks',  icon: '🍽',  sortOrder: 1,  subcategories: ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks'] },
  { name: 'Transport',      icon: '🚕',  sortOrder: 2,  subcategories: ['Taxi', 'Uber/Careem', 'Bus', 'Train', 'Other'] },
  { name: 'Shopping',       icon: '🛍',  sortOrder: 3,  subcategories: ['Perfume', 'Clothes', 'Dates', 'Gifts', 'Religious Items'] },
  { name: 'Personal',       icon: '🧴',  sortOrder: 4,  subcategories: ['Laundry', 'Toiletries', 'Personal Care', 'Miscellaneous'] },
  { name: 'Umrah',          icon: '🕋',  sortOrder: 5,  subcategories: ['Ihram', 'Ziyarat', 'Religious Expenses'] },
  { name: 'Accommodation',  icon: '🏨',  sortOrder: 6,  subcategories: ['Hotel', 'Other'] },
  { name: 'Other',          icon: '📦',  sortOrder: 7,  subcategories: ['Miscellaneous'] },
];

// ── Seed function ──────────────────────────────────────────────────────────

/**
 * Seed the database. Returns early if a trip already exists.
 * @returns {Promise<{ tripId: number, seeded: boolean }>}
 */
export async function seedDatabase() {
  const existingTrips = await db.trips.count();

  if (existingTrips > 0) {
    const trip = await db.trips.toCollection().first();
    return { tripId: trip.id, seeded: false };
  }

  console.info('[Seed] No trip found — seeding database...');

  const now = new Date().toISOString();

  // ── 1. Create Trip ───────────────────────────────────────────────────────
  const tripId = await db.trips.add({
    name:               'Umrah 2026',
    startDate:          '2026-09-25',
    endDate:            '2026-11-15',
    dailyAllowanceSar:  '100.00',
    homeCurrency:       'PKR',
    travelCurrency:     'SAR',
    createdAt:          now,
  });

  // ── 2. Create default categories + subcategories ─────────────────────────
  const categoryIdMap = {};  // name → id (for referencing in expenses below)

  for (const cat of DEFAULT_CATEGORIES) {
    const catId = await db.categories.add({
      tripId,
      name:       cat.name,
      icon:       cat.icon,
      parentId:   null,
      isDefault:  true,
      sortOrder:  cat.sortOrder,
      createdAt:  now,
    });
    categoryIdMap[cat.name] = catId;

    for (let i = 0; i < cat.subcategories.length; i++) {
      await db.categories.add({
        tripId,
        name:       cat.subcategories[i],
        icon:       cat.icon,
        parentId:   catId,
        isDefault:  true,
        sortOrder:  i + 1,
        createdAt:  now,
      });
    }
  }

  // ── 3. Exchange transactions ─────────────────────────────────────────────
  // Three exchanges demonstrating weighted average rate
  const exchanges = [
    { pkrGiven: '50000.00', sarReceived: '667.56', date: '2026-09-25', location: 'Karachi — Al-Habib Exchange', note: 'Before departure' },
    { pkrGiven: '30000.00', sarReceived: '397.35', date: '2026-10-01', location: 'Madinah — Al-Rajhi Bank',    note: '' },
    { pkrGiven: '20000.00', sarReceived: '263.85', date: '2026-10-15', location: 'Makkah — Exchange near Haram', note: 'Top-up' },
  ];

  const exchangeIds = [];
  for (const ex of exchanges) {
    const rate = calcAcquisitionRate(ex.pkrGiven, ex.sarReceived);
    const id = await db.exchanges.add({
      tripId,
      pkrGiven:        ex.pkrGiven,
      sarReceived:     ex.sarReceived,
      acquisitionRate: rate.toFixed(6),
      date:            ex.date,
      location:        ex.location,
      note:            ex.note,
      createdAt:       now,
      isSynced:        false,
    });
    exchangeIds.push(id);
  }

  // Calculate weighted avg rate across all 3 exchanges for expense snapshots
  const weightedRate = calcWeightedAvgRate(exchanges);
  const rateStr = weightedRate.toFixed(6);

  // ── 4. Sample expenses ───────────────────────────────────────────────────
  const foodCatId      = categoryIdMap['Food & Drinks'];
  const transportCatId = categoryIdMap['Transport'];
  const shoppingCatId  = categoryIdMap['Shopping'];
  const personalCatId  = categoryIdMap['Personal'];
  const umrahCatId     = categoryIdMap['Umrah'];

  /**
   * Helper to build a transaction with PKR snapshot.
   */
  function makeExpense({ amountSar, categoryId, date, location, note }) {
    const sar   = new Decimal(amountSar);
    const pkrEq = sar.times(weightedRate).toFixed(2);
    return {
      tripId,
      type:                'EXPENSE',
      amountSar,
      pkrEquivalent:       pkrEq,
      acquisitionRateUsed: rateStr,
      categoryId,
      subcategoryId:       null,
      date,
      location,
      note:                note || '',
      shoppingItemId:      null,
      createdAt:           now,
      isSynced:            false,
    };
  }

  const sampleExpenses = [
    makeExpense({ amountSar: '35.00',  categoryId: foodCatId,      date: '2026-09-26', location: 'Madinah', note: 'Dinner near Haram' }),
    makeExpense({ amountSar: '15.00',  categoryId: personalCatId,  date: '2026-09-26', location: 'Madinah', note: 'Laundry' }),
    makeExpense({ amountSar: '32.50',  categoryId: transportCatId, date: '2026-09-27', location: 'Madinah', note: 'Taxi to Masjid Quba' }),
    makeExpense({ amountSar: '120.00', categoryId: shoppingCatId,  date: '2026-09-28', location: 'Madinah', note: 'Perfume from souk' }),
    makeExpense({ amountSar: '22.00',  categoryId: foodCatId,      date: '2026-09-29', location: 'Madinah', note: 'Breakfast' }),
    makeExpense({ amountSar: '45.00',  categoryId: umrahCatId,     date: '2026-10-02', location: 'Makkah',  note: 'Ihram cloth' }),
    makeExpense({ amountSar: '18.50',  categoryId: transportCatId, date: '2026-10-03', location: 'Makkah',  note: 'Bus Makkah–Aziziyah' }),
    makeExpense({ amountSar: '65.00',  categoryId: shoppingCatId,  date: '2026-10-05', location: 'Makkah',  note: 'Dates and gifts' }),
    makeExpense({ amountSar: '12.00',  categoryId: personalCatId,  date: '2026-10-06', location: 'Makkah',  note: 'Toiletries' }),
    makeExpense({ amountSar: '28.00',  categoryId: foodCatId,      date: '2026-10-07', location: 'Makkah',  note: 'Lunch' }),
  ];

  for (const exp of sampleExpenses) {
    await db.transactions.add(exp);
  }

  console.info('[Seed] ✓ Trip, categories, exchanges, and sample expenses created. TripId:', tripId);
  return { tripId, seeded: true };
}
