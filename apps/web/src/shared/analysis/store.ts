import { useLiveQuery } from 'dexie-react-hooks';
import { GAME_PUZZLE_PREFIX, type OpeningTable } from '@knightfall/core';
import { db, getKV, KEYS, setKV, type GameSource, type StoredAnalysis, type StoredGame } from '../db.ts';
import type { EngineId } from '../engine/index.ts';
import { fetchChesscomUserGames, fetchLichessUserGames, resolveGameInput } from '../importers/index.ts';
import { isPuzzleOfGame } from './gamePuzzleLogic.ts';
import { removeNextPicks } from '../woodNext.ts';

/** IndexedDB side of Game Review: imported games, finished analyses, preferences, and the import entry points. */

export interface AnalysisPrefs {
  /** Engine build used for new reviews. */
  engine: EngineId;
  /** Last usernames typed into the import tabs ('' = none yet). Stored locally only. */
  lichessUser: string;
  chesscomUser: string;
}

export const DEFAULT_ANALYSIS_PREFS: AnalysisPrefs = { engine: 'lite', lichessUser: '', chesscomUser: '' };

function cleanPrefs(raw: unknown): AnalysisPrefs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    engine: r.engine === 'deep' ? 'deep' : 'lite',
    lichessUser: typeof r.lichessUser === 'string' ? r.lichessUser.slice(0, 30) : '',
    chesscomUser: typeof r.chesscomUser === 'string' ? r.chesscomUser.slice(0, 30) : '',
  };
}

export async function getAnalysisPrefs(): Promise<AnalysisPrefs> {
  return cleanPrefs(await getKV<unknown>(KEYS.analysisPrefs, null));
}

export async function setAnalysisPrefs(patch: Partial<AnalysisPrefs>): Promise<void> {
  await setKV(KEYS.analysisPrefs, cleanPrefs({ ...(await getAnalysisPrefs()), ...patch }));
}

/** Live preferences; undefined while loading. */
export function useAnalysisPrefs(): AnalysisPrefs | undefined {
  return useLiveQuery(getAnalysisPrefs, []);
}

/** Insert or refresh games. A row that was imported "for" a username keeps that marker. */
export async function saveGames(games: readonly StoredGame[]): Promise<void> {
  if (!games.length) return;
  await db.transaction('rw', db.games, async () => {
    const existing = await db.games.bulkGet(games.map((g) => g.key));
    await db.games.bulkPut(
      games.map((g, i) => {
        const old = existing[i];
        return old ? { ...g, importedAt: old.importedAt, ...(g.importedFor ? {} : old.importedFor ? { importedFor: old.importedFor } : {}) } : g;
      }),
    );
  });
}

export function getGame(key: string): Promise<StoredGame | undefined> {
  return db.games.get(key);
}

export function getAnalysis(gameKey: string): Promise<StoredAnalysis | undefined> {
  return db.analyses.get(gameKey);
}

export async function saveAnalysis(row: StoredAnalysis): Promise<void> {
  await db.analyses.put(row);
}

/** Remove a game, its analysis, your own review of it, and the practice puzzles (with their review rows) made from it. */
export async function deleteGame(key: string): Promise<void> {
  await db.transaction('rw', [db.games, db.analyses, db.selfReviews, db.customPuzzles, db.reviews, db.kv], async () => {
    await db.games.delete(key);
    await db.analyses.delete(key);
    await db.selfReviews.delete(key);
    const ids = (await db.customPuzzles.where('id').startsWith(`${GAME_PUZZLE_PREFIX}${key}-`).primaryKeys()) as string[];
    const own = ids.filter((id) => isPuzzleOfGame(id, key));
    await db.customPuzzles.bulkDelete(own);
    await db.reviews.bulkDelete(own);
    // A pick for the next Woodpecker set that points at a deleted puzzle would be a ghost.
    await removeNextPicks(own);
  });
}

/** Paste box: resolve a link / id / PGN, store the games, return them. Throws ImportError. */
export async function importGames(text: string): Promise<{ games: StoredGame[]; warnings: string[] }> {
  const result = await resolveGameInput(text);
  await saveGames(result.games);
  return result;
}

/**
 * Username import: fetch the newest games (30), store them, and remember the username for next time.
 * `onGame` fires as games arrive (Lichess streams). Throws ImportError.
 */
export async function importUserGames(site: 'lichess' | 'chesscom', username: string, opts: { signal?: AbortSignal; onGame?: (g: StoredGame) => void } = {}): Promise<StoredGame[]> {
  const games = site === 'lichess' ? await fetchLichessUserGames(username, opts) : await fetchChesscomUserGames(username, opts);
  await saveGames(games);
  await setAnalysisPrefs(site === 'lichess' ? { lichessUser: username.trim() } : { chesscomUser: username.trim() });
  return games;
}

/** Stored games of one site imported for `username` (case-insensitive), newest first. Undefined while loading. */
export function useUserGames(source: GameSource, username: string): StoredGame[] | undefined {
  const user = username.trim().toLowerCase();
  return useLiveQuery(async () => {
    if (!user) return [];
    const rows = await db.games.where('source').equals(source).toArray();
    return rows.filter((g) => g.importedFor === user).sort((a, b) => b.playedAt - a.playedAt);
  }, [source, user]);
}

export interface AnalysedGame {
  game: StoredGame;
  analysis: StoredAnalysis;
}

/** The most recently analysed games, newest first. Undefined while loading. */
export function useRecentAnalyses(limit = 12): AnalysedGame[] | undefined {
  return useLiveQuery(async () => {
    const analyses = await db.analyses.orderBy('analysedAt').reverse().limit(limit).toArray();
    const games = await db.games.bulkGet(analyses.map((a) => a.gameKey));
    return analyses.flatMap((analysis, i) => (games[i] ? [{ game: games[i]!, analysis }] : []));
  }, [limit]);
}

/** Keys of every game that has a stored analysis (for "Reviewed" badges in lists). */
export function useAnalysedKeys(): ReadonlySet<string> | undefined {
  return useLiveQuery(async () => new Set((await db.analyses.toCollection().primaryKeys()) as string[]), []);
}

let openingsPromise: Promise<OpeningTable | null> | null = null;

/** The opening table (public/openings.json), fetched once. Null when it cannot be loaded (book detection is then skipped). */
export function loadOpenings(): Promise<OpeningTable | null> {
  // A failed fetch is not cached: the next call tries again (this one still resolves null).
  openingsPromise ??= fetch('/openings.json')
    .then((r) => {
      if (r.ok) return r.json() as Promise<OpeningTable>;
      openingsPromise = null;
      return null;
    })
    .catch(() => {
      openingsPromise = null;
      return null;
    });
  return openingsPromise;
}
