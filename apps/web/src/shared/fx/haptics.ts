/** Short vibration patterns for right and wrong moves. Android only; iPhone Safari has no vibrate API. */

export type HapticKind = 'correct' | 'wrong' | 'solved' | 'strike' | 'win';

export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  correct: 12,
  wrong: [30, 40, 30],
  solved: [18, 40, 18],
  strike: [60],
  win: [20, 60, 40],
};

let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(HAPTIC_PATTERNS[kind]);
  } catch {
    /* vibration is best effort */
  }
}
