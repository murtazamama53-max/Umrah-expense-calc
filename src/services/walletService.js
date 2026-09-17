/**
 * UMRAH WALLET — Wallet Service (Phase 2)
 *
 * The Dexie-backed persistence + orchestration layer for the SAR wallet
 * domain: recording exchanges, recording expenses, and reading back the
 * wallet's current state. This is the piece Phase 1 deliberately left out
 * — exchangeService.js is pure calculation functions with zero I/O, and
 * nothing wrote real exchange/expense records except seed.js's ad hoc
 * sample data.
 *
 * This file introduces NO new financial logic. Every calculation is
 * delegated to the existing, already-tested functions in exchangeService.js
 * (calcAcquisitionRate, calcWeightedAvgRate, calcTotalSarAcquired,
 * calcTotalPkrInvested, calcTotalSarSpent, calcSarBalance,
 * calcBalanceSummary, calcExpensePkrSnapshot). This file only handles
 * reading/writing Dexie and shaping the result.
 *
 * OFFLINE-FIRST: everything here reads and writes IndexedDB directly.
 * Nothing in this file calls the Flask API — matching the existing
 * architecture where the backend is an optional, separate sync layer.
 *
 * HISTORICAL IMMUTABILITY: addExpense() snapshots pkrEquivalent and
 * acquisitionRateUsed once, at creation time, from the exchanges that
 * exist at that moment. Those two fields are never recalculated by any
 * function in this file after that — not by addExchange() adding more
 * exchanges later, not by getWalletSummary() reading the wallet's current
 * state. This mirrors exactly what the backend's create_transaction route
 * already does.
 */

import Decimal from 'decimal.js';
import { db } from '../db/dexie.js';
import {
  calcAcquisitionRate,
  calcTotalSarAcquired,
  calcTotalPkrInvested,
  calcTotalSarSpent,
  calcBalanceSummary,
  calcExpensePkrSnapshot,
} from './exchangeService.js';

const VALID_TRANSACTION_TYPES = ['EXPENSE', 'REFUND'];

/**
 * Record a new PKR→SAR exchange for a trip.
 *
 * acquisitionRate is always computed from pkrGiven/sarReceived via
 * calcAcquisitionRate() — a caller can never pass in its own rate. This
 * mirrors the backend, where the same rule is enforced server-side.
 *
 * @param {number} tripId
 * @param {{ pkrGiven: string|number, sarReceived: string|number, date: string, location?: string, note?: string }} input
 * @returns {Promise<Object>} The created exchange record, including its new id
 * @throws {Error} If pkrGiven or sarReceived is zero, negative, or not a number
 */
export async function addExchange(tripId, { pkrGiven, sarReceived, date, location, note } = {}) {
  if (!tripId) {
    throw new Error('tripId is required');
  }
  if (!date) {
    throw new Error('date is required');
  }

  // Throws on zero/negative/invalid pkrGiven or sarReceived — same guard
  // the pure calculation layer already enforces.
  const rate = calcAcquisitionRate(pkrGiven, sarReceived);

  const record = {
    tripId,
    pkrGiven: new Decimal(pkrGiven).toFixed(2),
    sarReceived: new Decimal(sarReceived).toFixed(2),
    acquisitionRate: rate.toFixed(6),
    date,
    location: location ?? null,
    note: note ?? null,
    createdAt: new Date().toISOString(),
    isSynced: false,
  };

  const id = await db.exchanges.add(record);
  return { id, ...record };
}

/**
 * Record a new expense or refund against the SAR wallet.
 *
 * pkrEquivalent and acquisitionRateUsed are computed ONCE here, from the
 * trip's exchanges as they exist right now, via calcExpensePkrSnapshot().
 * These two fields are a permanent historical snapshot — nothing in this
 * service ever recalculates them after this call.
 *
 * @param {number} tripId
 * @param {{
 *   amountSar: string|number,
 *   type?: 'EXPENSE'|'REFUND',
 *   categoryId: number,
 *   subcategoryId?: number,
 *   date: string,
 *   location?: string,
 *   note?: string,
 *   shoppingItemId?: number,
 * }} input
 * @returns {Promise<Object>} The created transaction record, including its new id
 * @throws {Error} If amountSar is zero/negative/invalid, or categoryId is missing
 */
export async function addExpense(tripId, {
  amountSar,
  type = 'EXPENSE',
  categoryId,
  subcategoryId,
  date,
  location = 'Other',
  note,
  shoppingItemId,
} = {}) {
  if (!tripId) {
    throw new Error('tripId is required');
  }
  if (!date) {
    throw new Error('date is required');
  }
  if (!categoryId) {
    throw new Error('categoryId is required');
  }
  if (!VALID_TRANSACTION_TYPES.includes(type)) {
    throw new Error(`type must be one of ${VALID_TRANSACTION_TYPES.join('/')}. Got: ${type}`);
  }

  // Validate amountSar unconditionally — calcExpensePkrSnapshot only
  // validates it when exchanges already exist (see its zero-exchanges
  // early return), so a trip with no exchanges yet wouldn't otherwise
  // catch a zero/negative amount here.
  const sar = new Decimal(amountSar);
  if (sar.lte(0)) {
    throw new Error(`amountSar must be greater than zero. Got: ${amountSar}`);
  }

  const exchanges = await db.exchanges.where('tripId').equals(tripId).toArray();
  const snapshot = calcExpensePkrSnapshot(amountSar, exchanges);

  const record = {
    tripId,
    type,
    amountSar: sar.toFixed(2),
    pkrEquivalent: snapshot.pkrEquivalent,
    acquisitionRateUsed: snapshot.acquisitionRateUsed,
    categoryId,
    subcategoryId: subcategoryId ?? null,
    date,
    location,
    note: note ?? null,
    shoppingItemId: shoppingItemId ?? null,
    createdAt: new Date().toISOString(),
    isSynced: false,
  };

  const id = await db.transactions.add(record);
  return { id, ...record };
}

/**
 * All exchanges recorded for a trip, oldest first.
 * @param {number} tripId
 * @returns {Promise<Array>}
 */
export async function listExchanges(tripId) {
  return db.exchanges.where('tripId').equals(tripId).sortBy('date');
}

/**
 * All expenses/refunds recorded for a trip, oldest first.
 * @param {number} tripId
 * @returns {Promise<Array>}
 */
export async function listExpenses(tripId) {
  return db.transactions.where('tripId').equals(tripId).sortBy('date');
}

/**
 * The SAR wallet's current state for a trip: how much SAR was acquired,
 * how much has been spent, what's left, and what that's worth in PKR
 * terms at the weighted-average acquisition rate (never the live rate).
 *
 * @param {number} tripId
 * @returns {Promise<{
 *   totalSarAcquired: string,
 *   totalPkrInvested: string,
 *   totalSarSpent: string,
 *   sarBalance: string,
 *   pkrValue: string,
 *   weightedRate: string,
 *   exchangeCount: number,
 *   transactionCount: number,
 * }>}
 */
export async function getWalletSummary(tripId) {
  if (!tripId) {
    throw new Error('tripId is required');
  }

  const [exchanges, transactions] = await Promise.all([
    db.exchanges.where('tripId').equals(tripId).toArray(),
    db.transactions.where('tripId').equals(tripId).toArray(),
  ]);

  const totalSarAcquired = calcTotalSarAcquired(exchanges);
  const totalPkrInvested = calcTotalPkrInvested(exchanges);
  const totalSarSpent = calcTotalSarSpent(transactions);
  const { balanceSar, pkrValue, weightedRate } = calcBalanceSummary(exchanges, transactions);

  return {
    totalSarAcquired: totalSarAcquired.toFixed(2),
    totalPkrInvested: totalPkrInvested.toFixed(2),
    totalSarSpent: totalSarSpent.toFixed(2),
    sarBalance: balanceSar.toFixed(2),
    pkrValue: pkrValue.toFixed(2),
    weightedRate: weightedRate.toFixed(6),
    exchangeCount: exchanges.length,
    transactionCount: transactions.length,
  };
}
