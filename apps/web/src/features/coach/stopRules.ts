import { dayKeyOf, isDateKey, weekStart } from '../../shared/localDate.ts';
import { planWeekStart } from './planLogic.ts';

/**
 * Stop rules for fast games: at most 10 bullet games a week and a stop after two blitz losses in a row.
 * Pure rules. The stored lists live in stopStore.ts.
 */

export type ActivityResult = 'win' | 'loss' | 'draw';
export type ActivitySpeed = 'blitz' | 'bullet';

/** One finished blitz or bullet game, as read from the chess.com archive. */
export interface ActivityGame {
  /** "cc-live-<id>" */
  key: string;
  /** When the game ended, in ms. */
  at: number;
  speed: ActivitySpeed;
  result: ActivityResult;
}

export interface CoachActivity {
  /** Lower-cased chess.com username the games belong to. */
  user: string;
  /** When the last sync finished, in ms. */
  lastSync: number | null;
  /** Oldest first. */
  games: ActivityGame[];
}

export const KEEP_DAYS = 35;
export const KEEP_GAMES = 2000;
export const BULLET_LIMIT = 10;
export const BULLET_NEAR = 8;
export const STOP_LOSSES = 2;
/** A hand-noted result matches a synced game that ended up to 15 minutes before the note or up to 2 minutes after it. */
export const MATCH_BEFORE_MS = 15 * 60_000;
export const MATCH_AFTER_MS = 2 * 60_000;
/** Most notes kept on one day. */
export const MAX_NOTES = 200;

const DAY_MS = 86_400_000;

export const EMPTY_ACTIVITY: CoachActivity = { user: '', lastSync: null, games: [] };

const RESULTS: readonly string[] = ['win', 'loss', 'draw'];

function cleanGame(raw: unknown): ActivityGame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const { key, at, speed, result } = r;
  if (typeof key !== 'string' || !key || key.length > 60) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null;
  if (speed !== 'blitz' && speed !== 'bullet') return null;
  if (typeof result !== 'string' || !RESULTS.includes(result)) return null;
  return { key, at: Math.floor(at), speed, result: result as ActivityResult };
}

/** Keeps good games from the last 35 days, one per key, at most the newest 2000, oldest first. */
export function pruneGames(list: unknown, now = Date.now()): ActivityGame[] {
  if (!Array.isArray(list)) return [];
  const cutoff = now - KEEP_DAYS * DAY_MS;
  const byKey = new Map<string, ActivityGame>();
  for (const raw of list) {
    const g = cleanGame(raw);
    if (g && g.at >= cutoff && g.at <= now + DAY_MS) byKey.set(g.key, g);
  }
  return [...byKey.values()].sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1)).slice(-KEEP_GAMES);
}

export function sanitizeActivity(raw: unknown, now = Date.now()): CoachActivity {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_ACTIVITY, games: [] };
  const r = raw as Record<string, unknown>;
  const lastSync = typeof r.lastSync === 'number' && Number.isFinite(r.lastSync) && r.lastSync > 0 ? r.lastSync : null;
  return { user: typeof r.user === 'string' ? r.user.trim().toLowerCase().slice(0, 30) : '', lastSync, games: pruneGames(r.games, now) };
}

/** The stored games with the freshly read ones added by key (a fresh row wins). */
export function mergeActivity(old: CoachActivity, fresh: readonly ActivityGame[], user: string, lastSync: number, now = lastSync): CoachActivity {
  const u = user.trim().toLowerCase();
  const keep = old.user === u ? old.games : [];
  return { user: u, lastSync, games: pruneGames([...keep, ...fresh], now) };
}

/* ---------- bullet ---------- */

export type BulletState = 'ok' | 'near' | 'full';

export interface BulletWeek {
  count: number;
  limit: number;
  state: BulletState;
}

/** Bullet games from the first day of this plan week (this week's Monday without a plan) to `today`, local days. */
export function bulletThisWeek(games: readonly ActivityGame[], today: string, startDate?: string): BulletWeek {
  const first = startDate ? planWeekStart(startDate, today) : weekStart(today);
  let count = 0;
  for (const g of games) {
    if (g.speed !== 'bullet') continue;
    const day = dayKeyOf(g.at);
    if (day >= first && day <= today) count++;
  }
  return { count, limit: BULLET_LIMIT, state: count >= BULLET_LIMIT ? 'full' : count >= BULLET_NEAR ? 'near' : 'ok' };
}

/* ---------- blitz ---------- */

export interface BlitzNote {
  at: number;
  result: 'win' | 'loss';
}

export interface BlitzSession {
  /** Results of the day in time order, notes that match a synced game counted once. */
  results: ActivityResult[];
  /** Losses in a row at the end of the day so far. */
  losses: number;
  /** True from two losses in a row. */
  stop: boolean;
}

/** The notes of a stored coachDays row, cleaned. */
export function sanitizeNotes(raw: unknown): BlitzNote[] {
  if (!Array.isArray(raw)) return [];
  const out: BlitzNote[] = [];
  for (const n of raw) {
    if (typeof n !== 'object' || n === null) continue;
    const { at, result } = n as Record<string, unknown>;
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) continue;
    if (result !== 'win' && result !== 'loss') continue;
    out.push({ at: Math.floor(at), result });
  }
  return out.sort((a, b) => a.at - b.at).slice(-MAX_NOTES);
}

export function blitzSession(games: readonly ActivityGame[], manual: readonly BlitzNote[], dateKey: string): BlitzSession {
  if (!isDateKey(dateKey)) return { results: [], losses: 0, stop: false };
  const synced = games.filter((g) => g.speed === 'blitz' && dayKeyOf(g.at) === dateKey).sort((a, b) => a.at - b.at);
  const taken = new Set<number>();
  const kept: { at: number; result: ActivityResult }[] = synced.map((g) => ({ at: g.at, result: g.result }));
  const notes = [...manual].filter((n) => dayKeyOf(n.at) === dateKey).sort((a, b) => a.at - b.at);
  for (const note of notes) {
    let best = -1;
    let bestGap = Infinity;
    synced.forEach((g, i) => {
      if (taken.has(i) || g.result !== note.result) return;
      const before = note.at - g.at; // positive: the game ended before the note
      if (before < -MATCH_AFTER_MS || before > MATCH_BEFORE_MS) return;
      const gap = Math.abs(before);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    if (best >= 0) taken.add(best);
    else kept.push({ at: note.at, result: note.result });
  }
  const results = kept.sort((a, b) => a.at - b.at).map((k) => k.result);
  let losses = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === 'loss'; i--) losses++;
  return { results, losses, stop: losses >= STOP_LOSSES };
}

/** The notes with one more at `at`. Capped at MAX_NOTES (the oldest drop out). */
export function withNote(notes: readonly BlitzNote[], at: number, result: 'win' | 'loss'): BlitzNote[] {
  return sanitizeNotes([...notes, { at, result }]);
}

/** The notes without the newest one. */
export function withoutLastNote(notes: readonly BlitzNote[]): BlitzNote[] {
  return sanitizeNotes(notes).slice(0, -1);
}
