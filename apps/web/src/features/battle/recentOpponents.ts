import type { EndInfo } from './battleState.ts';

/** Friends played in friend battles (pure). Stored in KV `recentOpponents`, newest first. */

export const MAX_RECENT = 8;

export interface RecentOpponent {
  code: string;
  name: string;
  rating: number;
  lastAt: number;
  w: number;
  l: number;
  d: number;
}

/** Add or refresh a friend at the front, keeping their record. */
export function upsertOpponent(list: readonly RecentOpponent[], p: { code: string; name: string; rating: number; at: number }): RecentOpponent[] {
  const old = list.find((o) => o.code === p.code);
  const entry: RecentOpponent = { code: p.code, name: p.name, rating: p.rating, lastAt: p.at, w: old?.w ?? 0, l: old?.l ?? 0, d: old?.d ?? 0 };
  return [entry, ...list.filter((o) => o.code !== p.code)].slice(0, MAX_RECENT);
}

/** Count a finished game against a friend; unknown codes leave the list unchanged. */
export function recordOpponentResult(list: readonly RecentOpponent[], code: string, result: EndInfo['result']): RecentOpponent[] {
  return list.map((o) => (o.code !== code ? o : { ...o, w: o.w + (result === 'win' ? 1 : 0), l: o.l + (result === 'loss' ? 1 : 0), d: o.d + (result === 'draw' ? 1 : 0) }));
}

export function removeOpponent(list: readonly RecentOpponent[], code: string): RecentOpponent[] {
  return list.filter((o) => o.code !== code);
}

/** Drop malformed stored entries. */
export function sanitizeRecent(raw: unknown): RecentOpponent[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const out: RecentOpponent[] = [];
  for (const o of raw) {
    if (!o || typeof o.code !== 'string' || typeof o.name !== 'string') continue;
    out.push({ code: o.code, name: o.name, rating: num(o.rating), lastAt: num(o.lastAt), w: num(o.w), l: num(o.l), d: num(o.d) });
  }
  return out.slice(0, MAX_RECENT);
}
