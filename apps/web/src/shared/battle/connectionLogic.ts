import type { PlayerInfo } from '@knightfall/core';

/** Pure rules for the app-wide battle socket (shared/battle/connection.ts). */

export type ConnStatus = 'connecting' | 'waking' | 'online' | 'offline' | 'outdated';

export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
/** An open socket that never answers `hello` with `welcome` within this long talks to a server without friend play. */
export const WELCOME_TIMEOUT_MS = 8000;

/** Reconnect delay after the previous one: doubles from 1 s up to 30 s. */
export function nextBackoff(prev: number): number {
  return Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, prev * 2));
}

/**
 * Status after a failed connection attempt. A hosted free-tier server may be asleep, so failures inside the
 * wake window report 'waking'; past it (or with no wake window, e.g. local dev) the server is 'offline'.
 */
export function statusAfterFailure(wakeWindowMs: number, outageStart: number, now: number): 'waking' | 'offline' {
  return wakeWindowMs > 0 && now - outageStart < wakeWindowMs ? 'waking' : 'offline';
}

/** True when the name or rating differs from what the server last heard in `hello`. */
export function helloChanged(prev: PlayerInfo | null, next: PlayerInfo): boolean {
  return !prev || prev.name !== next.name || prev.rating !== next.rating;
}
