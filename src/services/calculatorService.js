/**
 * UMRAH WALLET — Calculator Service
 *
 * SAR↔PKR conversion calculator.
 *
 * Three modes (as specified in Phase 3 of the build plan):
 *   1. MY RATE    — weighted-average acquisition rate (default, works offline)
 *   2. MANUAL     — temporary user-entered rate (calculation only, not stored)
 *   3. LIVE RATE  — reference market rate from cached snapshot (reference only)
 *
 * OFFLINE: This service requires only a Decimal rate. No network calls here.
 * The caller supplies the rate; this service does the math.
 */

import Decimal from 'decimal.js';

// ── Constants ──────────────────────────────────────────────────────────────

export const CALC_MODE = Object.freeze({
  MY_RATE:    'MY_RATE',    // Weighted average acquisition rate
  MANUAL:     'MANUAL',     // User-specified temporary rate
  LIVE:       'LIVE',       // Market reference rate from API snapshot
});

// ── Core conversion functions ──────────────────────────────────────────────

/**
 * Convert SAR → PKR using a given rate.
 *
 * pkr = sar × rate
 *
 * @param {number|string|Decimal} sarAmount - Amount in SAR
 * @param {number|string|Decimal} rate      - PKR per SAR (e.g. 74.90)
 * @returns {Decimal} PKR equivalent, 2 decimal places
 */
export function sarToPkr(sarAmount, rate) {
  const sar  = new Decimal(sarAmount);
  const r    = new Decimal(rate);

  if (sar.lt(0))  throw new Error('sarAmount cannot be negative');
  if (r.lte(0))   throw new Error('rate must be greater than zero');

  return sar.times(r).toDecimalPlaces(2);
}

/**
 * Convert PKR → SAR using a given rate.
 *
 * sar = pkr / rate
 *
 * @param {number|string|Decimal} pkrAmount - Amount in PKR
 * @param {number|string|Decimal} rate      - PKR per SAR (e.g. 74.90)
 * @returns {Decimal} SAR equivalent, 2 decimal places
 */
export function pkrToSar(pkrAmount, rate) {
  const pkr = new Decimal(pkrAmount);
  const r   = new Decimal(rate);

  if (pkr.lt(0))  throw new Error('pkrAmount cannot be negative');
  if (r.lte(0))   throw new Error('rate must be greater than zero');

  return pkr.dividedBy(r).toDecimalPlaces(2);
}

/**
 * Full calculator result object.
 *
 * @param {number|string|Decimal} sarAmount
 * @param {number|string|Decimal} rate
 * @param {keyof typeof CALC_MODE} mode
 * @returns {{
 *   sarAmount: string,
 *   pkrAmount: string,
 *   rate:      string,
 *   mode:      string
 * }}
 */
export function calculateSarToPkr(sarAmount, rate, mode = CALC_MODE.MY_RATE) {
  if (!Object.values(CALC_MODE).includes(mode)) {
    throw new Error(`Invalid calculator mode: ${mode}`);
  }

  const sar = new Decimal(sarAmount || 0);
  if (sar.isZero()) {
    return { sarAmount: '0.00', pkrAmount: '0.00', rate: rate ? new Decimal(rate).toFixed(6) : '0.000000', mode };
  }

  const pkr = sarToPkr(sar, rate);

  return {
    sarAmount: sar.toFixed(2),
    pkrAmount: pkr.toFixed(2),
    rate:      new Decimal(rate).toFixed(6),
    mode,
  };
}

// ── Formatting helpers ─────────────────────────────────────────────────────

/**
 * Format a Decimal (or string/number) as PKR display string.
 * e.g. 3743.5 → "PKR 3,744"  (no cents for PKR display)
 *
 * @param {number|string|Decimal} amount
 * @returns {string}
 */
export function formatPkr(amount) {
  const d = new Decimal(amount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return 'PKR ' + d.toNumber().toLocaleString('en-PK');
}

/**
 * Format a Decimal (or string/number) as SAR display string.
 * e.g. 50.5 → "50.50 SAR"
 *
 * @param {number|string|Decimal} amount
 * @param {boolean} [withCurrency=true]
 * @returns {string}
 */
export function formatSar(amount, withCurrency = true) {
  const d = new Decimal(amount).toDecimalPlaces(2);
  const str = d.toNumber().toLocaleString('en-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withCurrency ? `${str} SAR` : str;
}

/**
 * Format a rate as "74.90 PKR/SAR"
 *
 * @param {number|string|Decimal} rate
 * @returns {string}
 */
export function formatRate(rate) {
  return `${new Decimal(rate).toFixed(2)} PKR/SAR`;
}
