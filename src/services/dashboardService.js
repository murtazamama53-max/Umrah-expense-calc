/**
 * UMRAH WALLET — Dashboard Service
 *
 * Aggregation helpers for all dashboard metrics.
 * Pure functions — receive data, return computed summaries.
 * All monetary results are Decimal.js instances (caller converts to string for display).
 */

import Decimal from 'decimal.js';
import {
  calcTotalSarAcquired,
  calcTotalPkrInvested,
  calcTotalSarSpent,
  calcSarBalance,
  calcWeightedAvgRate,
} from './exchangeService.js';

// ── Date helpers ───────────────────────────────────────────────────────────

/**
 * Get ISO date string for today (YYYY-MM-DD) in local time.
 * @returns {string}
 */
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Calculate the number of days elapsed since trip start (inclusive of start day).
 * Returns 1 on the start day, 2 the next day, etc.
 *
 * @param {string} startDate - ISO date string "2026-09-25"
 * @returns {number} days elapsed (minimum 1)
 */
export function calcDaysElapsed(startDate) {
  const start = new Date(startDate);
  const now   = new Date();
  start.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diff = Math.floor((now - start) / 86_400_000);
  return Math.max(1, diff + 1);
}

/**
 * Calculate the total trip length in days.
 *
 * @param {string} startDate
 * @param {string} endDate
 * @returns {number}
 */
export function calcTripLength(startDate, endDate) {
  const start = new Date(startDate);
  const end   = new Date(endDate);
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Calculate days remaining in the trip.
 *
 * @param {string} endDate
 * @returns {number} may be negative if trip has ended
 */
export function calcDaysRemaining(endDate) {
  const end = new Date(endDate);
  const now = new Date();
  end.setHours(23, 59, 59, 999);
  now.setHours(0, 0, 0, 0);
  return Math.floor((end - now) / 86_400_000);
}

// ── Today's spending ───────────────────────────────────────────────────────

/**
 * Sum all EXPENSE transactions for today.
 *
 * @param {Array<{type: string, amountSar: string, date: string}>} transactions
 * @param {string} [dateStr]  - ISO date string to filter by (defaults to today)
 * @returns {Decimal} SAR spent today, 2 dp
 */
export function calcTodaySpending(transactions, dateStr = todayISO()) {
  if (!transactions || transactions.length === 0) return new Decimal(0);

  return transactions
    .filter(tx => tx.type === 'EXPENSE' && tx.date === dateStr)
    .reduce((sum, tx) => sum.plus(new Decimal(tx.amountSar)), new Decimal(0))
    .toDecimalPlaces(2);
}

// ── Daily allowance ────────────────────────────────────────────────────────

/**
 * Calculate remaining daily allowance.
 *
 * @param {string|number|Decimal} dailyAllowanceSar
 * @param {Array} transactions
 * @param {string} [dateStr]
 * @returns {{ allowance: Decimal, spent: Decimal, remaining: Decimal }}
 */
export function calcDailyAllowance(dailyAllowanceSar, transactions, dateStr = todayISO()) {
  const allowance = new Decimal(dailyAllowanceSar || 0);
  const spent     = calcTodaySpending(transactions, dateStr);
  const remaining = allowance.minus(spent).toDecimalPlaces(2);
  return { allowance, spent, remaining };
}

// ── Category breakdown ─────────────────────────────────────────────────────

/**
 * Calculate spending totals and percentages per category.
 *
 * @param {Array<{type: string, amountSar: string, categoryId: number}>} transactions
 * @param {Array<{id: number, name: string, icon: string}>}              categories
 * @returns {Array<{ categoryId: number, name: string, icon: string, totalSar: Decimal, percent: number }>}
 *          Sorted by totalSar descending
 */
export function calcCategoryBreakdown(transactions, categories) {
  if (!transactions || transactions.length === 0) return [];

  const expenses = transactions.filter(tx => tx.type === 'EXPENSE');
  if (expenses.length === 0) return [];

  // Sum by categoryId
  const totals = {};
  for (const tx of expenses) {
    const cid = tx.categoryId;
    totals[cid] = (totals[cid] || new Decimal(0)).plus(new Decimal(tx.amountSar));
  }

  const grandTotal = Object.values(totals).reduce((s, v) => s.plus(v), new Decimal(0));
  if (grandTotal.isZero()) return [];

  const catMap = {};
  for (const cat of categories) {
    catMap[cat.id] = cat;
  }

  return Object.entries(totals)
    .map(([cid, total]) => {
      const cat = catMap[Number(cid)] || { name: 'Unknown', icon: '❓' };
      return {
        categoryId: Number(cid),
        name:       cat.name,
        icon:       cat.icon,
        totalSar:   total.toDecimalPlaces(2),
        percent:    total.dividedBy(grandTotal).times(100).toDecimalPlaces(1).toNumber(),
      };
    })
    .sort((a, b) => b.totalSar.minus(a.totalSar).toNumber());
}

// ── Location breakdown ─────────────────────────────────────────────────────

/**
 * Calculate spending totals per location (Makkah / Madinah / Jeddah / Other).
 *
 * @param {Array<{type: string, amountSar: string, location: string}>} transactions
 * @returns {Object.<string, Decimal>}
 */
export function calcLocationBreakdown(transactions) {
  const result = { Makkah: new Decimal(0), Madinah: new Decimal(0), Jeddah: new Decimal(0), Other: new Decimal(0) };

  if (!transactions) return result;

  for (const tx of transactions) {
    if (tx.type !== 'EXPENSE') continue;
    const loc = result.hasOwnProperty(tx.location) ? tx.location : 'Other';
    result[loc] = result[loc].plus(new Decimal(tx.amountSar));
  }

  for (const k of Object.keys(result)) {
    result[k] = result[k].toDecimalPlaces(2);
  }

  return result;
}

// ── Full dashboard summary ─────────────────────────────────────────────────

/**
 * Compute all dashboard metrics in a single call.
 *
 * @param {Object} params
 * @param {Object}  params.trip          - Trip record
 * @param {Array}   params.exchanges     - All ExchangeTransactions for the trip
 * @param {Array}   params.transactions  - All Transactions for the trip
 * @param {Array}   params.categories    - All Categories for the trip
 * @param {string|null} params.liveRate  - Optional: live market SAR→PKR rate string
 * @returns {Object} Full dashboard summary (all Decimal values as .toString() strings)
 */
export function calcDashboardSummary({ trip, exchanges, transactions, categories, liveRate = null }) {
  const exArr  = exchanges    || [];
  const txArr  = transactions || [];
  const catArr = categories   || [];

  const totalSarAcquired  = calcTotalSarAcquired(exArr);
  const totalPkrInvested  = calcTotalPkrInvested(exArr);
  const totalSarSpent     = calcTotalSarSpent(txArr);
  const sarBalance        = calcSarBalance(exArr, txArr);
  const weightedRate      = exArr.length > 0 ? calcWeightedAvgRate(exArr) : new Decimal(0);
  const pkrBalanceValue   = sarBalance.times(weightedRate).toDecimalPlaces(2);
  const todaySpent        = calcTodaySpending(txArr);
  const todayPkrEquiv     = todaySpent.times(weightedRate).toDecimalPlaces(2);

  const daysElapsed   = calcDaysElapsed(trip.startDate);
  const daysRemaining = calcDaysRemaining(trip.endDate);
  const tripLength    = calcTripLength(trip.startDate, trip.endDate);

  const dailyAllowance = trip.dailyAllowanceSar
    ? calcDailyAllowance(trip.dailyAllowanceSar, txArr)
    : null;

  const categoryBreakdown = calcCategoryBreakdown(txArr, catArr);
  const locationBreakdown = calcLocationBreakdown(txArr);

  // Average daily spending (SAR) over days elapsed
  const avgDailySpending = daysElapsed > 0
    ? totalSarSpent.dividedBy(daysElapsed).toDecimalPlaces(2)
    : new Decimal(0);

  // Projected total spend at current daily rate
  const projectedTotalSpend = avgDailySpending.times(tripLength).toDecimalPlaces(2);

  return {
    // Wallet
    sarBalance:          sarBalance.toFixed(2),
    pkrBalanceValue:     pkrBalanceValue.toFixed(2),
    weightedRate:        weightedRate.toFixed(4),

    // Exchange totals
    totalSarAcquired:    totalSarAcquired.toFixed(2),
    totalPkrInvested:    totalPkrInvested.toFixed(2),

    // Spending
    totalSarSpent:       totalSarSpent.toFixed(2),
    todaySpentSar:       todaySpent.toFixed(2),
    todaySpentPkr:       todayPkrEquiv.toFixed(2),
    avgDailySpending:    avgDailySpending.toFixed(2),
    projectedTotalSpend: projectedTotalSpend.toFixed(2),

    // Trip days
    daysElapsed,
    daysRemaining,
    tripLength,

    // Daily allowance (null if not set)
    dailyAllowance: dailyAllowance
      ? {
          allowanceSar: dailyAllowance.allowance.toFixed(2),
          spentSar:     dailyAllowance.spent.toFixed(2),
          remainingSar: dailyAllowance.remaining.toFixed(2),
        }
      : null,

    // Breakdowns
    categoryBreakdown: categoryBreakdown.map(c => ({
      ...c,
      totalSar: c.totalSar.toFixed(2),
    })),
    locationBreakdown: Object.fromEntries(
      Object.entries(locationBreakdown).map(([k, v]) => [k, v.toFixed(2)])
    ),

    // Live rate (reference only, may be null)
    liveRate,
  };
}
