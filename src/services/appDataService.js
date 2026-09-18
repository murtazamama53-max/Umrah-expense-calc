/**
 * UMRAH WALLET - Offline app data bootstrap
 *
 * Creates only the durable app scaffolding needed for the UI to run:
 * one trip record and practical default categories. It deliberately does
 * not create sample exchanges or expenses, so dashboard numbers always
 * come from real user-entered financial records.
 */

import { db, initDB } from '../db/dexie.js';

export const DEFAULT_TRIP = Object.freeze({
  name: 'Umrah 2026',
  startDate: '2026-09-25',
  endDate: '2026-11-15',
  dailyAllowanceSar: '100.00',
  homeCurrency: 'PKR',
  travelCurrency: 'SAR',
});

export const DEFAULT_CATEGORIES = Object.freeze([
  { name: 'Transport', icon: '🚕', sortOrder: 1 },
  { name: 'Food', icon: '🍽', sortOrder: 2 },
  { name: 'Shopping', icon: '🛍', sortOrder: 3 },
  { name: 'Personal', icon: '🧴', sortOrder: 4 },
  { name: 'Laundry', icon: '🧺', sortOrder: 5 },
  { name: 'Other', icon: '📦', sortOrder: 6 },
]);

let bootstrapPromise = null;

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

export async function getPrimaryTrip() {
  return db.trips.toCollection().first();
}

export async function listTopLevelCategories(tripId) {
  const categories = await db.categories
    .where('tripId')
    .equals(tripId)
    .filter((category) => category.parentId === null || category.parentId === undefined)
    .sortBy('sortOrder');

  return categories;
}

async function ensureDefaultCategories(tripId) {
  const existing = await listTopLevelCategories(tripId);
  const existingNames = new Set(existing.map((category) => normalizeName(category.name)));
  const now = new Date().toISOString();

  for (const category of DEFAULT_CATEGORIES) {
    if (existingNames.has(normalizeName(category.name))) continue;

    await db.categories.add({
      tripId,
      name: category.name,
      icon: category.icon,
      parentId: null,
      isDefault: true,
      sortOrder: category.sortOrder,
      createdAt: now,
    });
  }
}

async function bootstrapAppData() {
  await initDB();

  let trip = await getPrimaryTrip();
  if (!trip) {
    const now = new Date().toISOString();
    const tripRecord = {
      ...DEFAULT_TRIP,
      createdAt: now,
    };
    const id = await db.trips.add(tripRecord);
    trip = { id, ...tripRecord };
  }

  await ensureDefaultCategories(trip.id);
  const categories = await listTopLevelCategories(trip.id);

  return { trip, categories };
}

export async function ensureAppData() {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = bootstrapAppData().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}
