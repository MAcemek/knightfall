import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_GLICKO, type Glicko, type Puzzle } from '@knightfall/core';

/** Local-first persistence (IndexedDB). No accounts in v1. */

export interface KV {
  key: string;
  value: unknown;
}

export type AttemptMode = 'rated' | 'daily' | 'rush' | 'battle' | 'custom';

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
}

export interface DailyRecord {
  date: string; // YYYY-MM-DD (UTC)
  puzzleId: string;
  solved: boolean;
  /** true when solved on the first try without hints */
  clean: boolean;
  at: number;
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

export const db = new Dexie('knightfall') as Dexie & {
  kv: EntityTable<KV, 'key'>;
  attempts: EntityTable<Attempt, 'id'>;
  daily: EntityTable<DailyRecord, 'date'>;
  rushRuns: EntityTable<RushRun, 'id'>;
  battles: EntityTable<BattleRecord, 'id'>;
  customPuzzles: EntityTable<CustomPuzzle, 'id'>;
};

db.version(1).stores({
  kv: 'key',
  attempts: '++id, puzzleId, mode, at',
  daily: 'date, at',
  rushRuns: '++id, mode, score, at',
  battles: '++id, at',
  customPuzzles: 'id, createdAt, updatedAt',
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
