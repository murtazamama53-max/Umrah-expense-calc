/**
 * UMRAH WALLET — Unit Tests: Calculator Service
 */

import { describe, it, expect } from 'vitest';
import {
  sarToPkr,
  pkrToSar,
  calculateSarToPkr,
  formatPkr,
  formatSar,
  formatRate,
  CALC_MODE,
} from '../src/services/calculatorService.js';
import Decimal from 'decimal.js';

describe('sarToPkr', () => {
  it('matches the product brief: 50 SAR × 74.86 ≈ 3,743 PKR', () => {
    const result = sarToPkr('50', '74.86');
    expect(result.toFixed(2)).toBe('3743.00');
  });

  it('returns Decimal instance', () => {
    expect(sarToPkr(100, 75)).toBeInstanceOf(Decimal);
  });

  it('handles string inputs', () => {
    const result = sarToPkr('100.50', '74.90');
    expect(result.toString()).toBe('7527.45');
  });

  it('rounds to 2 decimal places', () => {
    const result = sarToPkr('1', '74.123456');
    expect(result.toString()).toBe('74.12');
  });

  it('throws if sarAmount is negative', () => {
    expect(() => sarToPkr('-1', 75)).toThrow('sarAmount cannot be negative');
  });

  it('throws if rate is zero', () => {
    expect(() => sarToPkr(100, 0)).toThrow('rate must be greater than zero');
  });

  it('throws if rate is negative', () => {
    expect(() => sarToPkr(100, -5)).toThrow('rate must be greater than zero');
  });

  it('allows zero sarAmount (valid — no expense)', () => {
    const result = sarToPkr(0, 74.9);
    expect(result.toFixed(2)).toBe('0.00');
  });
});

describe('pkrToSar', () => {
  it('converts PKR to SAR correctly', () => {
    // PKR 3,745 ÷ 74.90 ≈ 50 SAR
    const result = pkrToSar('3745', '74.90');
    expect(result.toNumber()).toBeCloseTo(50.0, 0);
  });

  it('throws if pkrAmount is negative', () => {
    expect(() => pkrToSar(-100, 75)).toThrow('pkrAmount cannot be negative');
  });

  it('throws if rate is zero', () => {
    expect(() => pkrToSar(100, 0)).toThrow('rate must be greater than zero');
  });
});

describe('calculateSarToPkr', () => {
  it('returns correct result object', () => {
    const result = calculateSarToPkr('50', '74.86', CALC_MODE.MY_RATE);
    expect(result.sarAmount).toBe('50.00');
    expect(result.pkrAmount).toBe('3743.00');
    expect(result.mode).toBe('MY_RATE');
  });

  it('returns zeroes for zero input', () => {
    const result = calculateSarToPkr(0, '74.90', CALC_MODE.MY_RATE);
    expect(result.sarAmount).toBe('0.00');
    expect(result.pkrAmount).toBe('0.00');
  });

  it('throws on invalid mode', () => {
    expect(() => calculateSarToPkr(50, 74.9, 'INVALID_MODE')).toThrow('Invalid calculator mode');
  });

  it('works with MANUAL mode', () => {
    const result = calculateSarToPkr('100', '80', CALC_MODE.MANUAL);
    expect(result.pkrAmount).toBe('8000.00');
    expect(result.mode).toBe('MANUAL');
  });

  it('works with LIVE mode', () => {
    const result = calculateSarToPkr('100', '76.21', CALC_MODE.LIVE);
    expect(result.pkrAmount).toBe('7621.00');
    expect(result.mode).toBe('LIVE');
  });
});

describe('CALC_MODE enum', () => {
  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(CALC_MODE)).toBe(true);
  });

  it('has exactly three modes', () => {
    expect(Object.keys(CALC_MODE)).toHaveLength(3);
    expect(CALC_MODE.MY_RATE).toBe('MY_RATE');
    expect(CALC_MODE.MANUAL).toBe('MANUAL');
    expect(CALC_MODE.LIVE).toBe('LIVE');
  });
});

describe('formatPkr', () => {
  it('formats with PKR prefix and no cents', () => {
    const result = formatPkr('3743.50');
    expect(result).toMatch(/^PKR/);
    expect(result).toContain('3,744'); // rounds to nearest rupee
  });

  it('handles integer amounts', () => {
    expect(formatPkr(50000)).toMatch(/50,000/);
  });
});

describe('formatSar', () => {
  it('formats with SAR suffix', () => {
    expect(formatSar('35.00')).toBe('35.00 SAR');
  });

  it('omits currency when withCurrency=false', () => {
    expect(formatSar('35.00', false)).toBe('35.00');
  });
});

describe('formatRate', () => {
  it('formats rate with PKR/SAR suffix', () => {
    expect(formatRate('74.9')).toBe('74.90 PKR/SAR');
  });
});
