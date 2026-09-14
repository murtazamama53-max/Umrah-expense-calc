/**
 * UMRAH WALLET — Live Rate API Service
 *
 * Fetches the current SAR/PKR market rate from a free API.
 * This rate is REFERENCE ONLY — it never modifies historical records.
 *
 * The app works completely without this service (offline mode).
 * Always fall back to the cached snapshot if fetch fails.
 *
 * Provider: exchangerate.host (free, no key needed for basic usage)
 * Fallback:  Open Exchange Rates (if primary fails)
 */

import Decimal from 'decimal.js';
import db from '../db/dexie.js';

const PRIMARY_API   = 'https://api.exchangerate.host/convert?from=SAR&to=PKR&amount=1';
const CACHE_TTL_MS  = 6 * 60 * 60 * 1000; // 6 hours — don't over-poll the free API

/**
 * Fetch the live SAR→PKR market rate.
 * Returns null on failure — caller handles gracefully.
 *
 * @returns {Promise<{ rate: Decimal, source: string } | null>}
 */
async function fetchLiveRate() {
  try {
    const resp = await fetch(PRIMARY_API, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();

    // exchangerate.host returns { result: <number> } for /convert
    if (data && typeof data.result === 'number' && data.result > 0) {
      return {
        rate:   new Decimal(data.result).toDecimalPlaces(4),
        source: 'exchangerate.host',
      };
    }
    throw new Error('Unexpected response shape');
  } catch (err) {
    console.warn('[RateAPI] Primary fetch failed:', err.message);
    return null;
  }
}

/**
 * Get the live SAR→PKR rate, using cache if fresh.
 *
 * Strategy:
 *   1. Check IndexedDB for a snapshot fetched within TTL.
 *   2. If fresh → return cached snapshot immediately.
 *   3. If stale or absent → fetch from API, store snapshot, return.
 *   4. If fetch fails → return stale snapshot or null.
 *
 * @param {number} tripId
 * @returns {Promise<{ rate: string, source: string, fetchedAt: string, fromCache: boolean } | null>}
 */
export async function getLiveRate(tripId) {
  // 1. Check cache
  const cached = await db.rateSnapshots
    .where('[tripId+isLatest]')
    .equals([tripId, 1])
    .first();

  const now = Date.now();
  const cacheAge = cached ? now - new Date(cached.fetchedAt).getTime() : Infinity;

  if (cached && cacheAge < CACHE_TTL_MS) {
    return {
      rate:      cached.sarToPkr,
      source:    cached.source,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
    };
  }

  // 2. Fetch fresh rate
  const fresh = await fetchLiveRate();

  if (fresh) {
    const fetchedAt = new Date().toISOString();

    // Mark previous snapshots as not-latest
    await db.rateSnapshots
      .where('tripId')
      .equals(tripId)
      .modify({ isLatest: false });

    // Store new snapshot
    await db.rateSnapshots.add({
      tripId,
      sarToPkr:  fresh.rate.toString(),
      source:    fresh.source,
      fetchedAt,
      isLatest:  true,
    });

    return {
      rate:      fresh.rate.toString(),
      source:    fresh.source,
      fetchedAt,
      fromCache: false,
    };
  }

  // 3. Fetch failed — return stale cache if available
  if (cached) {
    console.warn('[RateAPI] Using stale cache (age:', Math.round(cacheAge / 60000), 'min)');
    return {
      rate:      cached.sarToPkr,
      source:    cached.source,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
      isStale:   true,
    };
  }

  // 4. Nothing available
  return null;
}

/**
 * Get the most recent cached rate without any network call.
 * Used by the calculator in offline mode.
 *
 * @param {number} tripId
 * @returns {Promise<string|null>} Rate string or null
 */
export async function getCachedRate(tripId) {
  const snapshot = await db.rateSnapshots
    .where('[tripId+isLatest]')
    .equals([tripId, 1])
    .first();

  return snapshot?.sarToPkr ?? null;
}

/**
 * Purge old rate snapshots (keep last 90 days per trip).
 * Call periodically to prevent unbounded growth.
 *
 * @param {number} tripId
 */
export async function pruneRateSnapshots(tripId) {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  await db.rateSnapshots
    .where('tripId').equals(tripId)
    .and(s => !s.isLatest && s.fetchedAt < cutoff)
    .delete();
}
