/**
 * A rough "game rating": how strong one side's play in a single game looked. Calibrated on 4,491 rated,
 * Lichess-analysed blitz/rapid player-games (scripts/fit-rating.mjs): Lichess accuracy ≈ 61.2 + 0.00918·rating,
 * with a large spread (residual SD ≈ 13.5 points), so one game says little. The estimate therefore anchors on
 * the player's known rating when there is one, moves half as far as the raw fit would, and stays within
 * ±600 of the anchor. It is shown as an estimate.
 */

export const RATING_FIT = { intercept: 61.2, slope: 0.00918 } as const;
/** Rating points per accuracy point above or below typical (half of 1 / slope). */
export const RATING_PER_ACCURACY_POINT = 1 / RATING_FIT.slope / 2;
export const RATING_MAX_SHIFT = 600;
/** Anchor when the player's rating is unknown (the calibration sample's mean, rounded). */
export const RATING_DEFAULT_ANCHOR = 1600;

const round50 = (x: number) => Math.round(x / 50) * 50;

/** Typical Lichess accuracy at a rating. */
export function typicalAccuracyAt(rating: number): number {
  return RATING_FIT.intercept + RATING_FIT.slope * rating;
}

/**
 * Estimated game rating from Lichess-formula accuracy (`ratingAccuracy`) and, when known, the player's
 * rating. Rounded to 50, between 100 and 3200. Null without an accuracy.
 */
export function estimateGameRating(lichessAccuracy: number | null, knownRating?: number | null): number | null {
  if (lichessAccuracy === null || !Number.isFinite(lichessAccuracy)) return null;
  const anchor = typeof knownRating === 'number' && Number.isFinite(knownRating) && knownRating > 0 ? knownRating : RATING_DEFAULT_ANCHOR;
  const shift = (lichessAccuracy - typicalAccuracyAt(anchor)) * RATING_PER_ACCURACY_POINT;
  const clamped = Math.max(-RATING_MAX_SHIFT, Math.min(RATING_MAX_SHIFT, shift));
  return Math.max(100, Math.min(3200, round50(anchor + clamped)));
}
