import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_GLICKO, type BattleSettings, type GameReport, type GameResult, type Glicko, type Puzzle, type SeriesInfo } from '@knightfall/core';

/** Local-first persistence (IndexedDB). No accounts in v1. */

export interface KV {
  key: string;
  value: unknown;
}

export type AttemptMode = 'rated' | 'daily' | 'rush' | 'battle' | 'custom' | 'theme' | 'review' | 'woodpecker';

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
  /** Woodpecker attempts (v5): the set and the cycle (1-based) they belong to. Not indexed. */
  setId?: string;
  cycle?: number;
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
  /** Friend challenge: casual, rating unchanged. Absent on older rows. Not indexed. */
  friendly?: boolean;
  /** Friend code of the opponent (friendly games only). */
  opponentCode?: string;
  /** Time and difficulty of a friend battle. */
  settings?: BattleSettings;
  /** Series state (best of 3) after this game. */
  series?: SeriesInfo;
  /** Club race: final place and number of players. Excluded from 1-on-1 stats. */
  club?: { place: number; players: number };
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

export type GameSource = 'lichess' | 'chesscom' | 'pgn' | 'bot';

export interface GamePlayer {
  name: string;
  rating?: number;
  title?: string;
}

/** A stored game (v3). `key` is stable per game: "li-<id8>", "cc-<live|daily>-<digits>", "pgn-<hash>", "bot-<id>". */
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

/** Spaced-repetition progress of one opening line (v4). */
export interface OpeningLineProgress {
  /** Line id from opening-lines.json. */
  id: string;
  family: string;
  color: 'w' | 'b';
  /** Leitner box 0..5. */
  box: number;
  /** Timestamp (ms) from which the line is due. */
  due: number;
  lastAt: number | null;
  misses: number;
}

export interface WoodCycle {
  /** 1-based. */
  n: number;
  startedAt: number;
  finishedAt: number | null;
  targetDays: number;
}

/** A Woodpecker set (v5): a fixed list of puzzles solved again and again, faster every time. */
export interface WoodSet {
  id: string;
  createdAt: number;
  name: string;
  /** Frozen copies in playing order: a rebuilt puzzle set or a deleted game never changes a set. */
  items: Puzzle[];
  cycles: WoodCycle[];
}

export type SelfReviewReason = 'check' | 'capture' | 'threat' | 'calculation' | 'time' | 'plan' | 'opening' | 'endgame';

/** The player's own look at a game before the engine ran (v5). One row per game. */
export interface SelfReview {
  gameKey: string;
  at: number;
  side: 'w' | 'b';
  /** Index of the move the player calls the point of no return; null = none. */
  turningPly: number | null;
  reason: SelfReviewReason | null;
  lesson: string;
  skipped: boolean;
}

export type CoachSpeed = 'rapid' | 'blitz' | 'bullet' | 'daily';

/** One rating on one day (v5). `id` is "chesscom-<speed>-<date>", so a second sync on the same day replaces it. */
export interface RatingLogRow {
  id: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  site: 'chesscom';
  speed: CoachSpeed;
  rating: number;
  /** chess.com username, lower case. Not indexed. */
  user?: string;
}

/** What the player ticked or noted on the Coach page on one local day (v5). */
export interface CoachDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Ids of the manual tasks done. */
  ticks: string[];
  /** Blitz results noted by hand, oldest first. */
  blitz: { at: number; result: 'win' | 'loss' }[];
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
  openingLines: EntityTable<OpeningLineProgress, 'id'>;
  woodSets: EntityTable<WoodSet, 'id'>;
  selfReviews: EntityTable<SelfReview, 'gameKey'>;
  ratingLog: EntityTable<RatingLogRow, 'id'>;
  coachDays: EntityTable<CoachDay, 'date'>;
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

// v4: opening trainer progress. Only the NEW table; v1 to v3 stay exactly as they are.
db.version(4).stores({
  openingLines: 'id, family, due',
});

// v5: Woodpecker sets, engine-off reviews and the Coach. Only NEW tables; v1 to v4 stay exactly as they are.
db.version(5).stores({
  woodSets: 'id, createdAt',
  selfReviews: 'gameKey, at',
  ratingLog: 'id, date',
  coachDays: 'date',
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
  /** Rated puzzle currently on screen and not yet finished: { puzzleId, puzzleRating, at, touched } | null. Shown again if left untouched, a miss if left after a move or a hint. */
  ratedPending: 'ratedPending',
  /** Settings object (shared/settingsLogic.ts). */
  settings: 'settings',
  /** Highest attempts.id already scanned for the review queue (number). */
  reviewCursor: 'reviewCursor',
  /** true once achievements earned before v2 were unlocked silently. */
  achievementsSeeded: 'achievementsSeeded',
  /** Game Review preferences (shared/analysis/prefs.ts): engine choice and last used usernames. */
  analysisPrefs: 'analysisPrefs',
  /** Friend-challenge code and secret token issued by the battle server (string), so the code survives reloads. */
  battleCode: 'battleCode',
  battleToken: 'battleToken',
  /** Friends played in friend battles (features/battle/recentOpponents.ts), newest first. */
  recentOpponents: 'recentOpponents',
  /** Solved endgame drills (features/endgames): id to { solved, best }. */
  endgameProgress: 'endgameProgress',
  /** Board vision drills (features/vision): best score per drill and side, keyed "find-w" and so on. */
  visionBest: 'visionBest',
  /** Puzzles picked for the next Woodpecker set (features/woodpecker): puzzle ids, oldest first. */
  woodNext: 'woodNext',
  /** Blunder check totals per local day (features/blundercheck). */
  blunderCheck: 'blunderCheck',
  /** The training plan (features/coach): username, start date, baselines, targets. Absent = no plan. */
  coachPlan: 'coachPlan',
  /** Blitz and bullet games of the last 35 days and the time of the last sync (features/coach). */
  coachActivity: 'coachActivity',
  /** Notes on Daily games in progress (features/coach). */
  dailyNotes: 'dailyNotes',
  /** Ticked library entries (features/coach): ids. */
  coachLibrary: 'coachLibrary',
  /** The bot game being played (features/play). Belongs to this device. */
  botGame: 'botGame',
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
