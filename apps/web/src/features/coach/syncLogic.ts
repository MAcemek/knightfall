import type { CoachSpeed } from '../../shared/db.ts';
import { cleanRating, COACH_SPEEDS } from './planLogic.ts';
import type { ActivityGame, ActivityResult } from './stopRules.ts';

/** Reading chess.com data for the Coach. Pure: what to keep from a raw archive entry and from the stats answer. */

/** chess.com result codes that mean a draw. Every other code that is not "win" is a loss for that side. */
export const DRAW_CODES: readonly string[] = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The player's own result in an archive entry, or null when the player is on neither side. */
export function resultOf(raw: unknown, user: string): ActivityResult | null {
  if (!isRecord(raw)) return null;
  const me = user.trim().toLowerCase();
  for (const side of ['white', 'black'] as const) {
    const p = raw[side];
    if (!isRecord(p) || typeof p.username !== 'string' || p.username.toLowerCase() !== me) continue;
    const code = typeof p.result === 'string' ? p.result : '';
    if (code === 'win') return 'win';
    return DRAW_CODES.includes(code) ? 'draw' : 'loss';
  }
  return null;
}

const GAME_URL = /\/game\/(live|daily)\/(\d{1,20})$/;

/** "cc-live-<id>" or "cc-daily-<id>" from the game link, as stored games are keyed. */
export function gameKeyOf(raw: unknown): string | null {
  if (!isRecord(raw) || typeof raw.url !== 'string') return null;
  const m = GAME_URL.exec(raw.url);
  return m ? `cc-${m[1]}-${m[2]}` : null;
}

export type Entry = { kind: 'activity'; game: ActivityGame } | { kind: 'import'; key: string } | { kind: 'skip' };

/**
 * What to do with one raw archive entry. Blitz and bullet only feed the stop rules. Rapid and Daily are imported when
 * they are not stored yet. Variants and everything else are left alone.
 */
export function classifyEntry(raw: unknown, user: string, stored: ReadonlySet<string>): Entry {
  if (!isRecord(raw) || raw.rules !== 'chess') return { kind: 'skip' };
  const key = gameKeyOf(raw);
  if (!key) return { kind: 'skip' };
  const cls = raw.time_class;
  if (cls === 'blitz' || cls === 'bullet') {
    const result = resultOf(raw, user);
    const end = raw.end_time;
    if (!result || typeof end !== 'number' || !Number.isFinite(end) || end <= 0) return { kind: 'skip' };
    return { kind: 'activity', game: { key, at: Math.round(end * 1000), speed: cls, result } };
  }
  if (cls === 'rapid' || cls === 'daily') return stored.has(key) ? { kind: 'skip' } : { kind: 'import', key };
  return { kind: 'skip' };
}

const STAT_FIELD: Record<CoachSpeed, string> = { rapid: 'chess_rapid', blitz: 'chess_blitz', bullet: 'chess_bullet', daily: 'chess_daily' };

/** Current ratings from the answer of /pub/player/<user>/stats. Anything missing or out of range is null. */
export function ratingsFromStats(body: unknown): Record<CoachSpeed, number | null> {
  const out: Record<CoachSpeed, number | null> = { rapid: null, blitz: null, bullet: null, daily: null };
  if (!isRecord(body)) return out;
  for (const s of COACH_SPEEDS) {
    const mode = body[STAT_FIELD[s]];
    const last = isRecord(mode) && isRecord(mode.last) ? mode.last.rating : undefined;
    out[s] = typeof last === 'number' ? cleanRating(Math.round(last)) : null;
  }
  return out;
}
