/**
 * UMRAH WALLET — Exchange Service
 *
 * Core business rules for PKR→SAR exchange and weighted-average acquisition rate.
 *
 * MONEY RULE: All inputs and outputs are Decimal.js instances.
 *   - Never use native JS Number for monetary arithmetic.
 *   - Round to 2 decimal places for storage; use 6 dp internally for rates.
 *
 * HISTORICAL IMMUTABILITY: Once an expense is recorded with a pkrEquivalent
 * snapshot, that value NEVER changes — not when new exchanges occur, not when
 * live rates change. This is enforced by the caller storing the snapshot, not
 * by this service.
 */

import Decimal from 'decimal.js';

// Configure Decimal globally for this app
Decimal.set({
  precision: 20,       // internal computation precision
  rounding: Decimal.ROUND_HALF_UP,
  toExpPos: 20,
  toExpNeg: -7,
});

// ── Guard helpers ──────────────────────────────────────────────────────────

/**
 * Convert a value to Decimal safely.
 * Accepts number, string, or Decimal.
 * @param {number|string|Decimal} val
 * @returns {Decimal}
 */
function toDecimal(val) {
  try {
    return new Decimal(val);
  } catch {
    throw new Error(`Invalid numeric value: ${val}`);
  }
}

/**
 * Assert that a Decimal is strictly positive.
 * @param {Decimal} d
 * @param {string} fieldName
 */
function assertPositive(d, fieldName) {
  if (d.lte(0)) {
    throw new Error(`${fieldName} must be greater than zero. Got: ${d.toString()}`);
  }
}

// ── Core exchange calculations ─────────────────────────────────────────────

/**
 * Calculate the acquisition rate for a single PKR→SAR exchange.
 *
 * Formula: acquisition_rate = pkr_given / sar_received
 * Meaning: "How many PKR did I spend per SAR?"
 *
 * Example: PKR 50,000 ÷ 667.56 SAR = 74.90 PKR/SAR
 *
 * @param {number|string|Decimal} pkrGiven    - PKR amount given
 * @param {number|string|Decimal} sarReceived - SAR amount received
 * @returns {Decimal} Acquisition rate (PKR per SAR), rounded to 6 decimal places
 * @throws {Error} If either value is zero or negative
 */
export function calcAcquisitionRate(pkrGiven, sarReceived) {
  const pkr = toDecimal(pkrGiven);
  const sar = toDecimal(sarReceived);

  assertPositive(pkr, 'pkrGiven');
  assertPositive(sar, 'sarReceived');

  return pkr.dividedBy(sar).toDecimalPlaces(6);
}

/**
 * Calculate the weighted-average acquisition rate across multiple exchanges.
 *
 * Formula: weighted_rate = sum(pkr_given) / sum(sar_received)
 *
 * This is NOT a simple average of rates — it is a weighted average by SAR volume.
 *
 * Example:
 *   Exchange 1: PKR 50,000 → 667.56 SAR @ 74.90
 *   Exchange 2: PKR 30,000 → 397.35 SAR @ 75.49
 *   Weighted:  80,000 / 1,064.91 = 75.12 PKR/SAR
 *
 * @param {Array<{pkrGiven: string|number|Decimal, sarReceived: string|number|Decimal}>} exchanges
 * @returns {Decimal} Weighted average rate (PKR per SAR), 6 decimal places
 * @throws {Error} If exchanges array is empty or totals are invalid
 */
export function calcWeightedAvgRate(exchanges) {
  if (!exchanges || exchanges.length === 0) {
    throw new Error('Cannot calculate weighted average rate: no exchanges provided');
  }

  let totalPkr = new Decimal(0);
  let totalSar = new Decimal(0);

  for (const ex of exchanges) {
    const pkr = toDecimal(ex.pkrGiven);
    const sar = toDecimal(ex.sarReceived);

    assertPositive(pkr, 'pkrGiven');
    assertPositive(sar, 'sarReceived');

    totalPkr = totalPkr.plus(pkr);
    totalSar = totalSar.plus(sar);
  }

  assertPositive(totalSar, 'total sarReceived');

  return totalPkr.dividedBy(totalSar).toDecimalPlaces(6);
}

/**
 * Calculate the total SAR acquired from all exchanges.
 *
 * @param {Array<{sarReceived: string|number|Decimal}>} exchanges
 * @returns {Decimal} Total SAR acquired, 2 decimal places
 */
export function calcTotalSarAcquired(exchanges) {
  if (!exchanges || exchanges.length === 0) return new Decimal(0);

  return exchanges
    .reduce((sum, ex) => sum.plus(toDecimal(ex.sarReceived)), new Decimal(0))
    .toDecimalPlaces(2);
}

/**
 * Calculate the total PKR invested across all exchanges.
 *
 * @param {Array<{pkrGiven: string|number|Decimal}>} exchanges
 * @returns {Decimal} Total PKR invested, 2 decimal places
 */
export function calcTotalPkrInvested(exchanges) {
  if (!exchanges || exchanges.length === 0) return new Decimal(0);

  return exchanges
    .reduce((sum, ex) => sum.plus(toDecimal(ex.pkrGiven)), new Decimal(0))
    .toDecimalPlaces(2);
}

/**
 * Calculate the total SAR spent from expense transactions.
 *
 * Only EXPENSE type reduces the wallet. REFUND increases it.
 *
 * @param {Array<{type: string, amountSar: string|number|Decimal}>} transactions
 * @returns {Decimal} Net SAR spent (expenses minus refunds), 2 decimal places
 */
export function calcTotalSarSpent(transactions) {
  if (!transactions || transactions.length === 0) return new Decimal(0);

  return transactions
    .reduce((sum, tx) => {
      const amount = toDecimal(tx.amountSar);
      if (tx.type === 'EXPENSE') return sum.plus(amount);
      if (tx.type === 'REFUND')  return sum.minus(amount);
      return sum;
    }, new Decimal(0))
    .toDecimalPlaces(2);
}

/**
 * Calculate the current SAR wallet balance.
 *
 * Formula: balance = total_sar_acquired − total_sar_spent
 *
 * @param {Array<{sarReceived: string|number|Decimal}>} exchanges
 * @param {Array<{type: string, amountSar: string|number|Decimal}>} transactions
 * @returns {Decimal} SAR balance, 2 decimal places (may be negative if overspent)
 */
export function calcSarBalance(exchanges, transactions) {
  const acquired = calcTotalSarAcquired(exchanges);
  const spent    = calcTotalSarSpent(transactions);
  return acquired.minus(spent).toDecimalPlaces(2);
}

/**
 * Calculate the PKR value of the remaining SAR balance using the
 * weighted-average acquisition rate (NOT the live market rate).
 *
 * @param {Array} exchanges
 * @param {Array} transactions
 * @returns {{ balanceSar: Decimal, pkrValue: Decimal, weightedRate: Decimal }}
 */
export function calcBalanceSummary(exchanges, transactions) {
  if (!exchanges || exchanges.length === 0) {
    return {
      balanceSar:   new Decimal(0),
      pkrValue:     new Decimal(0),
      weightedRate: new Decimal(0),
    };
  }

  const balanceSar   = calcSarBalance(exchanges, transactions);
  const weightedRate = calcWeightedAvgRate(exchanges);
  const pkrValue     = balanceSar.times(weightedRate).toDecimalPlaces(2);

  return { balanceSar, pkrValue, weightedRate };
}

/**
 * Compute the PKR equivalent snapshot for a new expense entry.
 *
 * IMPORTANT: This value must be stored WITH the transaction and must
 * NEVER be recalculated later. It is a historical cost snapshot.
 *
 * @param {number|string|Decimal} amountSar   - SAR amount of the expense
 * @param {Array}                 exchanges   - All exchanges so far (to compute current weighted rate)
 * @returns {{ pkrEquivalent: string, acquisitionRateUsed: string }}
 */
export function calcExpensePkrSnapshot(amountSar, exchanges) {
  if (!exchanges || exchanges.length === 0) {
    // No exchange records yet — PKR equivalent cannot be calculated
    return {
      pkrEquivalent:       '0.00',
      acquisitionRateUsed: '0.000000',
    };
  }

  const sar          = toDecimal(amountSar);
  assertPositive(sar, 'amountSar');

  const weightedRate = calcWeightedAvgRate(exchanges);
  const pkrEquiv     = sar.times(weightedRate).toDecimalPlaces(2);

  return {
    pkrEquivalent:       pkrEquiv.toFixed(2),
    acquisitionRateUsed: weightedRate.toFixed(6),
  };
}
