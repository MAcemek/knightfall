import { db, KEYS, type CoachSpeed, type GameSource, type RatingLogRow, type StoredGame } from '../../shared/db.ts';
import { fetchChesscomUserGames, type FetchFn, type FetchResponse } from '../../shared/importers/fetchers.ts';
import { ImportError, USERNAME } from '../../shared/importers/mappers.ts';
import { saveGames } from '../../shared/analysis/store.ts';
import { localDateKey } from '../../shared/localDate.ts';
import { COACH_SPEEDS, sanitizePlan, type CoachPlan } from './planLogic.ts';
import { mergeActivity, sanitizeActivity, type ActivityGame } from './stopRules.ts';
import { classifyEntry, ratingsFromStats } from './syncLogic.ts';

/**
 * Reads the player's public chess.com data: current ratings and the newest games. Only the username goes out, in the
 * URL of the public API. No login, no key, nothing else is sent.
 */

const defaultFetch: FetchFn = (url, init) => fetch(url, init);

/** An automatic sync waits this long after the last one (or the last try, even a failed one). */
export const AUTO_GAP_MS = 15 * 60_000;
/** A manual sync waits this long after the last try. */
export const MANUAL_GAP_MS = 20_000;
export const SYNC_MAX_GAMES = 300;

/** Current chess.com ratings of a player by speed. Throws ImportError with a message ready to show. */
export async function fetchChesscomStats(username: string, fetchFn: FetchFn = defaultFetch): Promise<Record<CoachSpeed, number | null>> {
  const user = username.trim().toLowerCase();
  if (!USERNAME.test(user)) throw new ImportError('invalid', 'Enter a chess.com username (letters, digits, - and _).');
  let res: FetchResponse;
  try {
    res = await fetchFn(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/stats`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ImportError('network', 'chess.com could not be reached. Check your connection.');
  }
  if (res.status === 404) throw new ImportError('not_found', `chess.com has no player called "${username.trim()}".`);
  if (res.status === 429) throw new ImportError('rate_limited', 'chess.com is busy. Try again in a minute.');
  if (!res.ok) throw new ImportError('network', `chess.com answered with an error (${res.status}).`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ImportError('server', 'chess.com sent an answer that could not be read. Try again later.');
  }
  return ratingsFromStats(body);
}

export interface SyncOptions {
  /** A manual sync (a button). Without it the sync is automatic and waits 15 minutes between runs. */
  force?: boolean;
  fetchFn?: FetchFn;
  now?: number;
}

export interface SyncResult {
  /** Rapid and Daily games stored that were not stored before. */
  newGames: number;
  /** Ratings written to the history. */
  ratings: number;
  /** Set when nothing was done: no plan or username, too soon after the last try, or the username changed meanwhile. */
  skipped?: 'no-plan' | 'recent' | 'changed';
}

const skipped = (why: NonNullable<SyncResult['skipped']>): SyncResult => ({ newGames: 0, ratings: 0, skipped: why });

let inFlight: Promise<SyncResult> | null = null;
/** The last time a sync started, kept in memory so a failure also holds back the next automatic try. */
let lastTry: { user: string; at: number } | null = null;

/** For tests: forget the in-memory state. */
export function resetSyncState(): void {
  inFlight = null;
  lastTry = null;
}

async function readPlanRow(): Promise<CoachPlan | null> {
  return sanitizePlan((await db.kv.get(KEYS.coachPlan))?.value);
}

const sameUser = (plan: CoachPlan | null, user: string) => !!plan && plan.username.toLowerCase() === user;

async function run(opts: SyncOptions): Promise<SyncResult> {
  const now = opts.now ?? Date.now();
  const fetchFn = opts.fetchFn ?? defaultFetch;
  const plan = await readPlanRow();
  if (!plan || !plan.username) return skipped('no-plan');
  const user = plan.username.toLowerCase();

  const activity = sanitizeActivity((await db.kv.get(KEYS.coachActivity))?.value, now);
  const tried = lastTry && lastTry.user === user ? lastTry.at : 0;
  if (opts.force) {
    if (tried && now - tried < MANUAL_GAP_MS) return skipped('recent');
  } else {
    const last = Math.max(tried, activity.user === user ? (activity.lastSync ?? 0) : 0);
    if (last && now - last < AUTO_GAP_MS) return skipped('recent');
  }
  lastTry = { user, at: now };

  // 1. Ratings.
  const stats = await fetchChesscomStats(user, fetchFn);
  if (!sameUser(await readPlanRow(), user)) return skipped('changed');
  const date = localDateKey(new Date(now));
  const rows: RatingLogRow[] = COACH_SPEEDS.flatMap((speed) => {
    const rating = stats[speed];
    return rating === null ? [] : [{ id: `chesscom-${speed}-${date}`, date, site: 'chesscom' as const, speed, rating, user }];
  });
  if (rows.length) await db.ratingLog.bulkPut(rows);

  // 2. Games. Blitz and bullet only feed the stop rules; rapid and Daily are imported when they are new.
  const stored = new Set((await db.games.where('source').equals('chesscom' satisfies GameSource).primaryKeys()) as string[]);
  const fresh = new Map<string, ActivityGame>();
  const games: StoredGame[] = await fetchChesscomUserGames(user, {
    max: SYNC_MAX_GAMES,
    fetchFn,
    now,
    accept: (raw) => {
      const entry = classifyEntry(raw, user, stored);
      if (entry.kind === 'activity') fresh.set(entry.game.key, entry.game);
      return entry.kind === 'import';
    },
  });
  if (!sameUser(await readPlanRow(), user)) return skipped('changed');
  await saveGames(games);

  // 3. Remember the fast games. The plan is read again inside the transaction, so a username change cannot be overwritten.
  const kept = await db.transaction('rw', db.kv, async () => {
    if (!sameUser(sanitizePlan((await db.kv.get(KEYS.coachPlan))?.value), user)) return false;
    const old = sanitizeActivity((await db.kv.get(KEYS.coachActivity))?.value, now);
    await db.kv.put({ key: KEYS.coachActivity, value: mergeActivity(old, [...fresh.values()], user, now) });
    return true;
  });
  if (!kept) return skipped('changed');
  return { newGames: games.length, ratings: rows.length };
}

/**
 * Syncs once. Does nothing without a plan that has a username. One sync runs at a time: a call while one is running gets
 * that run's answer. Throws ImportError with a message ready to show.
 */
export function syncCoach(opts: SyncOptions = {}): Promise<SyncResult> {
  if (inFlight) return inFlight;
  const p = run(opts).finally(() => {
    if (inFlight === p) inFlight = null;
  });
  inFlight = p;
  return p;
}
