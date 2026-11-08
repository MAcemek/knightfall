import { seededFloat, seededInt } from './rng.ts';

/** Puzzle buckets are 100 rating points wide, from MIN_BUCKET to MAX_BUCKET inclusive. */
export const BUCKET_SIZE = 100;
export const MIN_BUCKET = 400;
export const MAX_BUCKET = 2900;

export function bucketFor(rating: number): number {
  const b = Math.floor(rating / BUCKET_SIZE) * BUCKET_SIZE;
  return Math.max(MIN_BUCKET, Math.min(MAX_BUCKET, b));
}

export function bucketFileName(bucket: number): string {
  return `bucket-${String(bucket).padStart(4, '0')}.json`;
}

/**
 * Target difficulty for the i-th puzzle of a Rush/Battle run.
 * Starts very easy and climbs steadily, flattening after ~30 puzzles so long runs stay reachable.
 */
export function rampRating(index: number, start = 400, step = 40): number {
  const linear = start + step * index;
  const eased = index > 30 ? linear - (index - 30) * step * 0.35 : linear;
  return Math.min(MAX_BUCKET + 50, Math.round(eased));
}

/** Target rating for a rated-mode puzzle: player rating ± spread, deterministic per (seed, index). */
export function nearRating(playerRating: number, seed: string | number, index: number, spread = 150): number {
  return Math.round(playerRating + (seededFloat(seed, index) * 2 - 1) * spread);
}

/** Deterministic pick inside a bucket. Both Battle clients call this with the same seed. */
export function pickIndex(seed: string | number, index: number, bucketLength: number): number {
  if (bucketLength <= 0) return 0;
  return seededInt(seed, index * 7919 + 13, bucketLength);
}
