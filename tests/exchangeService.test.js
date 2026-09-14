/**
 * UMRAH WALLET — Unit Tests: Exchange Service
 *
 * Tests for all business-logic functions in exchangeService.js
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  calcAcquisitionRate,
  calcWeightedAvgRate,
  calcTotalSarAcquired,
  calcTotalPkrInvested,
  calcTotalSarSpent,
  calcSarBalance,
  calcBalanceSummary,
  calcExpensePkrSnapshot,
} from '../src/services/exchangeService.js';

// ── calcAcquisitionRate ────────────────────────────────────────────────────

describe('calcAcquisitionRate', () => {
  it('computes the exact rate from the brief example', () => {
    // PKR 50,000 ÷ 667.56 SAR = 74.90... PKR/SAR
    const rate = calcAcquisitionRate('50000', '667.56');
    expect(rate.toFixed(2)).toBe('74.90');
  });

  it('returns a Decimal instance', () => {
    const rate = calcAcquisitionRate(100, 2);
    expect(rate).toBeInstanceOf(Decimal);
    expect(rate.toFixed(6)).toBe('50.000000');
  });

  it('handles decimal PKR and SAR values', () => {
    const rate = calcAcquisitionRate('74900.00', '1000.00');
    expect(rate.toFixed(6)).toBe('74.900000');
  });

  it('rounds to 6 decimal places', () => {
    const rate = calcAcquisitionRate('100', '3');
    // 100 / 3 = 33.333333...
    expect(rate.toString()).toBe('33.333333');
  });

  it('throws if pkrGiven is zero', () => {
    expect(() => calcAcquisitionRate(0, 100)).toThrow('pkrGiven must be greater than zero');
  });

  it('throws if sarReceived is zero', () => {
    expect(() => calcAcquisitionRate(50000, 0)).toThrow('sarReceived must be greater than zero');
  });

  it('throws if pkrGiven is negative', () => {
    expect(() => calcAcquisitionRate(-100, 50)).toThrow('pkrGiven must be greater than zero');
  });

  it('throws if sarReceived is negative', () => {
    expect(() => calcAcquisitionRate(100, -50)).toThrow('sarReceived must be greater than zero');
  });

  it('throws on non-numeric string input', () => {
    expect(() => calcAcquisitionRate('abc', 100)).toThrow();
  });
});

// ── calcWeightedAvgRate ────────────────────────────────────────────────────

describe('calcWeightedAvgRate', () => {
  it('returns single exchange rate when only one exchange', () => {
    const exchanges = [{ pkrGiven: '50000', sarReceived: '667.56' }];
    const rate = calcWeightedAvgRate(exchanges);
    expect(rate.toFixed(2)).toBe('74.90');
  });

  it('correctly weights two exchanges by SAR volume (not simple average)', () => {
    // Exchange 1: PKR 50,000 → 667.56 SAR @ 74.90
    // Exchange 2: PKR 30,000 → 397.35 SAR @ 75.49
    // Weighted: 80,000 / 1,064.91 ≈ 75.12
    const exchanges = [
      { pkrGiven: '50000', sarReceived: '667.56' },
      { pkrGiven: '30000', sarReceived: '397.35' },
    ];
    const rate = calcWeightedAvgRate(exchanges);
    // 80000 / 1064.91 = 75.1199...
    expect(rate.toDecimalPlaces(2).toNumber()).toBeCloseTo(75.12, 1);
  });

  it('correctly weights three exchanges (seed data scenario)', () => {
    const exchanges = [
      { pkrGiven: '50000', sarReceived: '667.56' },
      { pkrGiven: '30000', sarReceived: '397.35' },
      { pkrGiven: '20000', sarReceived: '263.85' },
    ];
    const rate = calcWeightedAvgRate(exchanges);
    // 100000 / 1328.76 = 75.26...
    expect(rate.toDecimalPlaces(2).toNumber()).toBeCloseTo(75.26, 1);
  });

  it('weighted average differs from simple average', () => {
    // Demonstrate that this is NOT a simple average of rates
    const exchanges = [
      { pkrGiven: '100000', sarReceived: '1000' },  // Rate = 100 PKR/SAR (large)
      { pkrGiven: '100',    sarReceived: '100'  },  // Rate = 1 PKR/SAR (small)
    ];
    const weighted = calcWeightedAvgRate(exchanges);
    const simpleAvg = new Decimal(100).plus(1).dividedBy(2); // = 50.5

    // Weighted = (100000 + 100) / (1000 + 100) = 100100/1100 ≈ 91.0
    expect(weighted.toDecimalPlaces(1).toNumber()).not.toBe(simpleAvg.toNumber());
    expect(weighted.toDecimalPlaces(2).toNumber()).toBeCloseTo(91.0, 0);
  });

  it('throws if exchanges array is empty', () => {
    expect(() => calcWeightedAvgRate([])).toThrow('no exchanges provided');
  });

  it('throws if exchanges is null', () => {
    expect(() => calcWeightedAvgRate(null)).toThrow();
  });
});

// ── calcTotalSarAcquired ───────────────────────────────────────────────────

describe('calcTotalSarAcquired', () => {
  it('sums SAR from multiple exchanges', () => {
    const exchanges = [
      { sarReceived: '667.56' },
      { sarReceived: '397.35' },
      { sarReceived: '263.85' },
    ];
    const total = calcTotalSarAcquired(exchanges);
    expect(total.toString()).toBe('1328.76');
  });

  it('returns 0 for empty array', () => {
    expect(calcTotalSarAcquired([]).toString()).toBe('0');
  });

  it('returns 0 for null', () => {
    expect(calcTotalSarAcquired(null).toString()).toBe('0');
  });
});

// ── calcTotalSarSpent ──────────────────────────────────────────────────────

describe('calcTotalSarSpent', () => {
  it('sums EXPENSE transactions', () => {
    const txs = [
      { type: 'EXPENSE', amountSar: '35.00' },
      { type: 'EXPENSE', amountSar: '15.00' },
      { type: 'EXPENSE', amountSar: '32.50' },
    ];
    expect(calcTotalSarSpent(txs).toFixed(2)).toBe('82.50');
  });

  it('subtracts REFUND transactions', () => {
    const txs = [
      { type: 'EXPENSE', amountSar: '100.00' },
      { type: 'REFUND',  amountSar: '25.00' },
    ];
    expect(calcTotalSarSpent(txs).toFixed(2)).toBe('75.00');
  });

  it('ignores unrecognised transaction types', () => {
    const txs = [
      { type: 'EXPENSE',  amountSar: '50.00' },
      { type: 'TRANSFER', amountSar: '200.00' },
    ];
    expect(calcTotalSarSpent(txs).toFixed(2)).toBe('50.00');
  });

  it('returns 0 for empty array', () => {
    expect(calcTotalSarSpent([]).toString()).toBe('0');
  });
});

// ── calcSarBalance ─────────────────────────────────────────────────────────

describe('calcSarBalance', () => {
  it('computes balance correctly', () => {
    const exchanges = [
      { pkrGiven: '50000', sarReceived: '667.56' },
      { pkrGiven: '30000', sarReceived: '397.35' },
    ];
    const transactions = [
      { type: 'EXPENSE', amountSar: '35.00' },
      { type: 'EXPENSE', amountSar: '15.00' },
      { type: 'EXPENSE', amountSar: '120.00' },
    ];
    // Acquired: 1064.91; Spent: 170.00; Balance: 894.91
    const balance = calcSarBalance(exchanges, transactions);
    expect(balance.toString()).toBe('894.91');
  });

  it('returns full acquired amount if no transactions', () => {
    const exchanges = [{ pkrGiven: '50000', sarReceived: '500' }];
    expect(calcSarBalance(exchanges, []).toFixed(2)).toBe('500.00');
  });

  it('returns 0 balance if no exchanges', () => {
    const transactions = [{ type: 'EXPENSE', amountSar: '100' }];
    const balance = calcSarBalance([], transactions);
    expect(balance.toFixed(2)).toBe('-100.00');
  });
});

// ── calcBalanceSummary ─────────────────────────────────────────────────────

describe('calcBalanceSummary', () => {
  it('returns zeroes if no exchanges', () => {
    const result = calcBalanceSummary([], []);
    expect(result.balanceSar.toString()).toBe('0');
    expect(result.pkrValue.toString()).toBe('0');
    expect(result.weightedRate.toString()).toBe('0');
  });

  it('computes correct PKR value from weighted rate', () => {
    // 1000 SAR acquired @ 74.90 PKR/SAR, 100 SAR spent
    // Balance = 900 SAR; PKR value = 900 × 74.9 = 67,410 PKR
    const exchanges    = [{ pkrGiven: '74900', sarReceived: '1000' }];
    const transactions = [{ type: 'EXPENSE', amountSar: '100' }];
    const result = calcBalanceSummary(exchanges, transactions);
    expect(result.balanceSar.toFixed(2)).toBe('900.00');
    expect(result.pkrValue.toFixed(2)).toBe('67410.00');
    expect(result.weightedRate.toFixed(2)).toBe('74.90');
  });
});

// ── calcExpensePkrSnapshot ─────────────────────────────────────────────────

describe('calcExpensePkrSnapshot', () => {
  it('produces correct PKR snapshot from the product brief', () => {
    // Acquisition rate: 74.90; Expense: 50 SAR → PKR 3,745
    const exchanges = [{ pkrGiven: '50000', sarReceived: '667.56' }];
    const snapshot  = calcExpensePkrSnapshot('50', exchanges);
    const pkr = parseFloat(snapshot.pkrEquivalent);
    // Should be approximately 3,745 (50 × 74.90...)
    expect(pkr).toBeGreaterThan(3740);
    expect(pkr).toBeLessThan(3750);
  });

  it('returns zero snapshot if no exchanges', () => {
    const snapshot = calcExpensePkrSnapshot('50', []);
    expect(snapshot.pkrEquivalent).toBe('0.00');
    expect(snapshot.acquisitionRateUsed).toBe('0.000000');
  });

  it('snapshot is immutable concept — different exchanges produce different values', () => {
    // If exchanges change later, the SNAPSHOT remains what it was at recording time
    const exchanges1 = [{ pkrGiven: '74900', sarReceived: '1000' }]; // rate 74.9
    const exchanges2 = [{ pkrGiven: '80000', sarReceived: '1000' }]; // rate 80.0

    const snap1 = calcExpensePkrSnapshot('100', exchanges1);
    const snap2 = calcExpensePkrSnapshot('100', exchanges2);

    expect(snap1.pkrEquivalent).toBe('7490.00');
    expect(snap2.pkrEquivalent).toBe('8000.00');
    // These are DIFFERENT because they capture the rate AT RECORDING TIME
  });

  it('throws if amountSar is zero or negative', () => {
    const exchanges = [{ pkrGiven: '50000', sarReceived: '667' }];
    expect(() => calcExpensePkrSnapshot('0',   exchanges)).toThrow();
    expect(() => calcExpensePkrSnapshot('-10', exchanges)).toThrow();
  });
});
