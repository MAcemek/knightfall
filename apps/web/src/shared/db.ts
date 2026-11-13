import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_GLICKO, type GameReport, type GameResult, type Glicko, type Puzzle } from '@knightfall/core';

/** Local-first persistence (IndexedDB). No accounts in v1. */

export interface KV {
  key: string;
  value: unknown;
}

export type AttemptMode = 'rated' | 'daily' | 'rush' | 'battle' | 'custom' | 'theme' | 'review';

export interface Attempt {
  id?: number;
  puzzleId: string;
  mode: AttemptMode;
  solved: boolean;
  puzzleRating: number;
  ratingBefore?: number;
  ratingAfter?: number;
  delta?: number;
  hintsUsed: number;
  timeMs: number;
  at: number;
  /** Puzzle themes at the time of the attempt (v2+; older rows are resolved via findPuzzle). Not indexed. */
  themes?: string[];
}

export interface DailyRecord {
  date: string; // YYYY-MM-DD (UTC)
  puzzleId: string;
  solved: boolean;
  /** true when solved on the first try without hints */
  clean: boolean;
  at: number;
  /**
   * Late play (the day had already ended in UTC). `solved`/`clean` only ever describe a SAME-DAY result,
   * so streak readers can keep using `solved`; late plays are tracked with these two flags.
   */
  solvedLate?: boolean;
  /** The record was created after the day had passed. */
  playedLate?: boolean;
}

export type RushMode = '3min' | '5min' | 'survival';

export interface RushRun {
  id?: number;
  mode: RushMode;
  score: number;
  strikes: number;
  bestCombo: number;
  highestRating: number;
  puzzles: { id: string; rating: number; solved: boolean }[];
  at: number;
}

export interface BattleRecord {
  id?: number;
  at: number;
  result: 'win' | 'loss' | 'draw';
  reason: string;
  opponentName: string;
  opponentRating: number;
  you: { solved: number; strikes: number };
  opponent: { solved: number; strikes: number };
  ratingBefore: number;
  ratingAfter: number;
}

export interface CustomPuzzle extends Puzzle {
  source: 'custom';
  createdAt: number;
  updatedAt: number;
  author?: string;
  plays?: number;
  solves?: number;
}

/** A missed puzzle waiting in the spaced-repetition review queue (one row per puzzle). */
export interface ReviewItem {
  puzzleId: string;
  puzzleRating: number;
  themes?: string[];
  /** Leitner box 0..5; higher = longer interval. */
  box: number;
  /** Timestamp (ms) from which the puzzle is due. */
  due: number;
  addedAt: number;
  /** Last time it was reviewed (null = never). */
  lastAt: number | null;
  /** Times it was missed again (in review or in any other mode). */
  lapses: number;
  /** Clean review solves so far. */
  reps: number;
}

/** An unlocked achievement (id from shared/progress/achievements.ts). */
export interface AchievementRow {
  id: string;
  at: number;
}

export type GameSource = 'lichess' | 'chesscom' | 'pgn';

export interface GamePlayer {
  name: string;
  rating?: number;
  title?: string;
}

/** An imported game (v3). `key` is stable per game: "li-<id8>", "cc-<live|daily>-<digits>", "pgn-<hash>". */
export interface StoredGame {
  key: string;
  source: GameSource;
  /** Link back to the game on its site. */
  url?: string;
  pgn: string;
  white: GamePlayer;
  black: GamePlayer;
  result: GameResult;
  /** When the game was played (ms); falls back to the import time when the PGN has no date. */
  playedAt: number;
  importedAt: number;
  /** Number of half-moves. */
  plies: number;
  /** "blitz", "rapid", "daily"... as named by the site. */
  speed?: string;
  /** PGN TimeControl, e.g. "180+0". */
  timeControl?: string;
  opening?: { eco?: string; name?: string };
  /** The site's own accuracy numbers, when it has analysed the game (shown next to ours as a cross-check). */
  siteAccuracy?: { white: number; black: number };
  /** Lower-cased username this game was imported for (username imports only). Decides "your" side. */
  importedFor?: string;
}

/** A finished engine review of one game (v3). One row per game; re-analysing replaces it. */
export interface StoredAnalysis {
  gameKey: string;
  analysedAt: number;
  engine: 'lite' | 'deep';
  depth: number;
  report: GameReport;
  /** Engine build that produced the evaluations (see ENGINE_BUILD); absent on older rows. Not indexed. */
  engineBuild?: string;
}

export const db = new Dexie('knightfall') as Dexie & {
  kv: EntityTable<KV, 'key'>;
  attempts: EntityTable<Attempt, 'id'>;
  daily: EntityTable<DailyRecord, 'date'>;
  rushRuns: EntityTable<RushRun, 'id'>;
  battles: EntityTable<BattleRecord, 'id'>;
  customPuzzles: EntityTable<CustomPuzzle, 'id'>;
  reviews: EntityTable<ReviewItem, 'puzzleId'>;
  achievements: EntityTable<AchievementRow, 'id'>;
  games: EntityTable<StoredGame, 'key'>;
  analyses: EntityTable<StoredAnalysis, 'gameKey'>;
};

db.version(1).stores({
  kv: 'key',
  attempts: '++id, puzzleId, mode, at',
  daily: 'date, at',
  rushRuns: '++id, mode, score, at',
  battles: '++id, at',
  customPuzzles: 'id, createdAt, updatedAt',
});

// v2: review queue + achievements. Only NEW tables are listed; Dexie keeps every v1 table and its data as is.
db.version(2).stores({
  reviews: 'puzzleId, due',
  achievements: 'id, at',
});

// v3: Game Review. Again only NEW tables; v1 and v2 stay exactly as they are.
db.version(3).stores({
  games: 'key, source, playedAt, importedAt',
  analyses: 'gameKey, analysedAt',
});

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setKV<T>(key: string, value: T): Promise<void> {
  await db.kv.put({ key, value });
}

/** Well-known KV keys. */
export const KEYS = {
  puzzleRating: 'puzzleRating', // Glicko
  puzzleStreak: 'puzzleStreak', // { current: number, best: number }
  battleRating: 'battleRating', // number (Elo)
  playerName: 'playerName', // string
  /** Rated puzzle currently on screen and not yet finished: { puzzleId, puzzleRating, at } | null. Settled as a miss if abandoned. */
  ratedPending: 'ratedPending',
  /** Settings object (shared/settingsLogic.ts). */
  settings: 'settings',
  /** Highest attempts.id already scanned for the review queue (number). */
  reviewCursor: 'reviewCursor',
  /** true once achievements earned before v2 were unlocked silently. */
  achievementsSeeded: 'achievementsSeeded',
  /** Game Review preferences (shared/analysis/prefs.ts): engine choice and last used usernames. */
  analysisPrefs: 'analysisPrefs',
} as const;

export interface StreakState {
  current: number;
  best: number;
}

export const defaults = {
  puzzleRating: DEFAULT_GLICKO as Glicko,
  puzzleStreak: { current: 0, best: 0 } as StreakState,
  battleRating: 1200,
};
