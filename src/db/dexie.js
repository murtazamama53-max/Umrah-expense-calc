/**
 * UMRAH WALLET — IndexedDB Schema (Dexie.js)
 *
 * This is the primary data store. The app works 100% offline via this DB.
 * Flask backend is an optional sync layer — never a hard dependency.
 *
 * Money rule: ALL monetary values are stored as strings in the DB to avoid
 * floating-point precision loss. They are converted to Decimal.js instances
 * at the service layer for computation. Never use raw JS Number for money.
 */

import Dexie from 'dexie';

// ── Entity types (JSDoc for IDE support) ───────────────────────────────────

/**
 * @typedef {Object} Trip
 * @property {number}  [id]
 * @property {string}  name            - e.g. "Umrah 2026"
 * @property {string}  startDate       - ISO date string "2026-09-25"
 * @property {string}  endDate         - ISO date string "2026-11-15"
 * @property {string}  [dailyAllowanceSar] - Optional daily budget, stored as string
 * @property {string}  homeCurrency    - Always "PKR" for this app
 * @property {string}  travelCurrency  - Always "SAR" for this app
 * @property {string}  createdAt       - ISO timestamp
 */

/**
 * @typedef {Object} ExchangeTransaction
 * @property {number}  [id]
 * @property {number}  tripId
 * @property {string}  pkrGiven        - Decimal string, e.g. "50000.00"
 * @property {string}  sarReceived     - Decimal string, e.g. "667.56"
 * @property {string}  acquisitionRate - Computed: pkrGiven / sarReceived, stored as string
 * @property {string}  date            - ISO date string
 * @property {string}  [location]      - Free text: "Karachi Money Changer" etc.
 * @property {string}  [note]
 * @property {string}  createdAt       - ISO timestamp
 * @property {boolean} [isSynced]      - Whether pushed to Flask backend
 */

/**
 * @typedef {Object} Transaction
 * @property {number}  [id]
 * @property {number}  tripId
 * @property {'EXPENSE'|'REFUND'}  type
 * @property {string}  amountSar           - Decimal string
 * @property {string}  pkrEquivalent       - SNAPSHOT: amount × weighted rate AT ENTRY TIME
 * @property {string}  acquisitionRateUsed - SNAPSHOT: weighted avg rate at entry time
 * @property {number}  categoryId
 * @property {number}  [subcategoryId]
 * @property {string}  date                - ISO date string
 * @property {'Makkah'|'Madinah'|'Jeddah'|'Other'}  location
 * @property {string}  [note]
 * @property {number}  [shoppingItemId]    - Optional link to ShoppingItem
 * @property {string}  createdAt           - ISO timestamp
 * @property {boolean} [isSynced]
 */

/**
 * @typedef {Object} Category
 * @property {number}   [id]
 * @property {number}   tripId
 * @property {string}   name
 * @property {string}   icon          - Emoji character, e.g. "🍽"
 * @property {number}   [parentId]    - null = top-level; set = subcategory
 * @property {boolean}  isDefault     - true = system category, cannot delete
 * @property {number}   sortOrder
 * @property {string}   createdAt
 */

/**
 * @typedef {Object} ShoppingItem
 * @property {number}  [id]
 * @property {number}  tripId
 * @property {string}  name
 * @property {number}  [categoryId]
 * @property {string}  [expectedSar]   - Decimal string
 * @property {boolean} isPurchased
 * @property {string}  [actualSar]     - Decimal string, set when purchased
 * @property {number}  [transactionId] - Linked expense after purchase
 * @property {string}  [note]
 * @property {string}  createdAt
 */

/**
 * @typedef {Object} ExchangeRateSnapshot
 * @property {number}  [id]
 * @property {number}  tripId
 * @property {string}  sarToPkr        - Live market rate as Decimal string
 * @property {string}  source          - API name e.g. "exchangerate.host"
 * @property {string}  fetchedAt       - ISO timestamp
 * @property {boolean} isLatest        - Only one snapshot per trip has isLatest=true
 */

/**
 * @typedef {Object} SyncQueueItem
 * @property {number}  [id]
 * @property {string}  entity          - 'exchanges' | 'transactions' | 'categories' | 'shoppingItems'
 * @property {number}  entityId
 * @property {'CREATE'|'UPDATE'|'DELETE'}  action
 * @property {Object}  payload
 * @property {string}  createdAt
 * @property {number}  retryCount
 * @property {string}  [lastError]
 */

// ── Database class ─────────────────────────────────────────────────────────

class UmrahWalletDB extends Dexie {
  constructor() {
    super('UmrahWalletDB');

    /**
     * Schema v1 — DO NOT modify existing fields without bumping version.
     * Add new fields to existing stores by bumping version and adding
     * an upgrade() callback. Never drop fields without migration.
     *
     * Index syntax:
     *   '++id'  = auto-increment primary key
     *   'field' = indexed field
     *   '[a+b]' = compound index
     *   '&field'= unique index
     */
    this.version(1).stores({
      trips:
        '++id, name, startDate',

      exchanges:
        '++id, tripId, date, [tripId+date]',

      transactions:
        '++id, tripId, type, categoryId, subcategoryId, date, location, shoppingItemId, [tripId+date], [tripId+categoryId]',

      categories:
        '++id, tripId, parentId, isDefault, sortOrder, [tripId+parentId]',

      shoppingItems:
        '++id, tripId, isPurchased, categoryId, [tripId+isPurchased]',

      rateSnapshots:
        '++id, tripId, isLatest, fetchedAt, [tripId+isLatest]',

      syncQueue:
        '++id, entity, entityId, action, createdAt',
    });

    // Typed table references (for IDE autocomplete)
    /** @type {Dexie.Table<Trip, number>} */
    this.trips = this.table('trips');

    /** @type {Dexie.Table<ExchangeTransaction, number>} */
    this.exchanges = this.table('exchanges');

    /** @type {Dexie.Table<Transaction, number>} */
    this.transactions = this.table('transactions');

    /** @type {Dexie.Table<Category, number>} */
    this.categories = this.table('categories');

    /** @type {Dexie.Table<ShoppingItem, number>} */
    this.shoppingItems = this.table('shoppingItems');

    /** @type {Dexie.Table<ExchangeRateSnapshot, number>} */
    this.rateSnapshots = this.table('rateSnapshots');

    /** @type {Dexie.Table<SyncQueueItem, number>} */
    this.syncQueue = this.table('syncQueue');
  }
}

// ── Singleton export ───────────────────────────────────────────────────────

export const db = new UmrahWalletDB();

/**
 * Call once on app startup to open the database and verify it is accessible.
 * Throws if IndexedDB is unavailable (e.g. private browsing in some browsers).
 */
export async function initDB() {
  try {
    await db.open();
    console.info('[UmrahWallet] IndexedDB opened — version', db.verno);
    return true;
  } catch (err) {
    console.error('[UmrahWallet] Failed to open IndexedDB:', err);
    throw err;
  }
}

export default db;
