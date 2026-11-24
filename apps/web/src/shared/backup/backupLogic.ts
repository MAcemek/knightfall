import { MOVE_CLASSES, REPORT_VERSION } from '@knightfall/core';
import type {
  AchievementRow,
  Attempt,
  BattleRecord,
  CustomPuzzle,
  DailyRecord,
  KV,
  OpeningLineProgress,
  ReviewItem,
  RushRun,
  StoredAnalysis,
  StoredGame,
} from '../db.ts';

/**
 * Pure model of the progress backup file (no Dexie, React or DOM). All user progress lives in this browser,
 * so everything read from a file is untrusted: every row is checked here before backup.ts writes anything.
 * Rows the app itself writes must always pass; the checks only cover what a page would crash on.
 */

export const BACKUP_FORMAT = 'knightfall-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

/** Literal of EXPORT_FORMAT in features/custom/logic.ts (not imported: that would pull the feature in). */
const CUSTOM_EXPORT_FORMAT = 'knightfall-custom-puzzles';

/** Row type of every table in shared/db.ts. Add a new table here AND to BACKUP_TABLES (a test compares to db.tables). */
export interface TableRows {
  kv: KV;
  attempts: Attempt;
  daily: DailyRecord;
  rushRuns: RushRun;
  battles: BattleRecord;
  customPuzzles: CustomPuzzle;
  reviews: ReviewItem;
  achievements: AchievementRow;
  games: StoredGame;
  analyses: StoredAnalysis;
  openingLines: OpeningLineProgress;
}

export type TableName = keyof TableRows;

export const BACKUP_TABLES: readonly TableName[] = [
  'kv', 'attempts', 'daily', 'rushRuns', 'battles', 'customPuzzles', 'reviews', 'achievements', 'games', 'analyses', 'openingLines',
];

/**
 * kv keys that belong to this device only: never written to a backup and never taken from one.
 * battleToken is a secret that proves ownership of the friend code; a restored ratedPending would be settled as a miss.
 */
export const DEVICE_KEYS: readonly string[] = ['battleCode', 'battleToken', 'ratedPending'];

export interface BackupFile {
  format: string;
  version: number;
  dbVersion: number;
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
}

export interface CleanBackup {
  exportedAt: string;
  dbVersion: number;
  tables: { [T in TableName]: TableRows[T][] };
}

export interface BackupSummary {
  exportedAt: string;
  playerName: string | null;
  puzzleRating: number | null;
  attempts: number;
  battles: number;
  games: number;
  customPuzzles: number;
  /** Damaged or duplicate rows that were left out. */
  skipped: number;
}

export type ParseResult = { ok: true; backup: CleanBackup; summary: BackupSummary } | { ok: false; error: string };

export function isDeviceKey(key: unknown): boolean {
  return typeof key === 'string' && DEVICE_KEYS.includes(key);
}

/** Wrap table dumps in the file shape. Device-only kv rows are dropped; every other kv row is kept. */
export function buildBackup(tables: Record<TableName, unknown[]>, dbVersion: number, nowIso: string): BackupFile {
  const out = {} as Record<TableName, unknown[]>;
  for (const name of BACKUP_TABLES) out[name] = tables[name] ?? [];
  out.kv = out.kv.filter((r) => !(isObj(r) && isDeviceKey(r.key)));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, dbVersion, exportedAt: nowIso, tables: out };
}

export function backupFileName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `knightfall-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

/* ---------- guards ---------- */

type Rec = Record<string, unknown>;

function isObj(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isPosInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0;
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
/** Absent (or null) or passing `f`. */
const opt = (x: unknown, f: (v: unknown) => boolean): boolean => x === undefined || x === null || f(x);
const oneOf = (x: unknown, list: readonly string[]): boolean => typeof x === 'string' && list.includes(x);
const isStats = (x: unknown): boolean => isObj(x) && isNum(x.solved) && isNum(x.strikes);
const isSide = (x: unknown): boolean => isObj(x) && (x.white === null || isNum(x.white)) && (x.black === null || isNum(x.black));
const isBox = (x: unknown): boolean => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 5;

const ATTEMPT_MODES = ['rated', 'daily', 'rush', 'battle', 'custom', 'theme', 'review'];
const RUSH_MODES = ['3min', '5min', 'survival'];
const RESULTS = ['win', 'loss', 'draw'];
const GAME_SOURCES = ['lichess', 'chesscom', 'pgn'];
const GAME_RESULTS = ['1-0', '0-1', '1/2-1/2', '*'];
const ENGINES = ['lite', 'deep'];
const PHASES = ['opening', 'middlegame', 'endgame'];
const LEVELS = ['easier', 'normal', 'harder'];

function isAttempt(r: unknown): boolean {
  return (
    isObj(r) && isPosInt(r.id) && isStr(r.puzzleId) && oneOf(r.mode, ATTEMPT_MODES) && isBool(r.solved) && isNum(r.puzzleRating) &&
    isNum(r.hintsUsed) && isNum(r.timeMs) && isNum(r.at) &&
    opt(r.ratingBefore, isNum) && opt(r.ratingAfter, isNum) && opt(r.delta, isNum) && opt(r.themes, isStrArr)
  );
}

function isDaily(r: unknown): boolean {
  return isObj(r) && isStr(r.date) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isStr(r.puzzleId) && isBool(r.solved) && isBool(r.clean) && isNum(r.at);
}

function isRushRun(r: unknown): boolean {
  return (
    isObj(r) && isPosInt(r.id) && oneOf(r.mode, RUSH_MODES) && isNum(r.score) && isNum(r.strikes) && isNum(r.bestCombo) &&
    isNum(r.highestRating) && isNum(r.at) &&
    Array.isArray(r.puzzles) && r.puzzles.every((p) => isObj(p) && isStr(p.id) && isNum(p.rating) && isBool(p.solved))
  );
}

function isBattle(r: unknown): boolean {
  return (
    isObj(r) && isPosInt(r.id) && isNum(r.at) && oneOf(r.result, RESULTS) && isStr(r.reason) && isStr(r.opponentName) &&
    isNum(r.opponentRating) && isStats(r.you) && isStats(r.opponent) && isNum(r.ratingBefore) && isNum(r.ratingAfter) &&
    opt(r.opponentCode, isStr) &&
    opt(r.settings, (s) => isObj(s) && isNum(s.durationMs) && oneOf(s.level, LEVELS)) &&
    opt(r.series, (s) => isObj(s) && (s.length === 1 || s.length === 3) && isNum(s.game) && isNum(s.me) && isNum(s.opp)) &&
    opt(r.club, (c) => isObj(c) && isNum(c.place) && isNum(c.players))
  );
}

function isCustomPuzzle(r: unknown): boolean {
  return (
    isObj(r) && isStr(r.id) && isStr(r.fen) && isStrArr(r.moves) && isBool(r.opponentFirst) && isNum(r.rating) && isStrArr(r.themes) &&
    r.source === 'custom' && isNum(r.createdAt) && isNum(r.updatedAt) &&
    opt(r.title, isStr) && opt(r.author, isStr) && opt(r.gameUrl, isStr) && opt(r.plays, isNum) && opt(r.solves, isNum) &&
    opt(r.alts, (a) => isObj(a) && Object.values(a).every(isStrArr))
  );
}

function isReview(r: unknown): boolean {
  return (
    isObj(r) && isStr(r.puzzleId) && isNum(r.puzzleRating) && isBox(r.box) && isNum(r.due) && isNum(r.addedAt) &&
    opt(r.lastAt, isNum) && isNum(r.lapses) && isNum(r.reps) && opt(r.themes, isStrArr)
  );
}

function isAchievement(r: unknown): boolean {
  return isObj(r) && isStr(r.id) && isNum(r.at);
}

const isPlayer = (p: unknown): boolean => isObj(p) && isStr(p.name) && opt(p.rating, isNum) && opt(p.title, isStr);

function isGame(r: unknown): boolean {
  return (
    isObj(r) && isStr(r.key) && oneOf(r.source, GAME_SOURCES) && isStr(r.pgn) && isPlayer(r.white) && isPlayer(r.black) &&
    oneOf(r.result, GAME_RESULTS) && isNum(r.playedAt) && isNum(r.importedAt) && isNum(r.plies) &&
    opt(r.url, isStr) && opt(r.speed, isStr) && opt(r.timeControl, isStr) && opt(r.importedFor, isStr) &&
    opt(r.opening, (o) => isObj(o) && opt(o.eco, isStr) && opt(o.name, isStr)) &&
    opt(r.siteAccuracy, (a) => isObj(a) && isNum(a.white) && isNum(a.black))
  );
}

function isMove(m: unknown): boolean {
  return (
    isObj(m) && isNum(m.ply) && (m.color === 'w' || m.color === 'b') && isNum(m.moveNumber) && isStr(m.san) && isStr(m.uci) &&
    isStr(m.fenBefore) && isStr(m.fenAfter) && oneOf(m.class, MOVE_CLASSES) && oneOf(m.phase, PHASES) &&
    isNum(m.winBefore) && isNum(m.winAfter) && isNum(m.epLoss) && isNum(m.accuracy) && isNum(m.cpLoss) &&
    opt(m.best, (b) => isObj(b) && isStr(b.uci) && isStr(b.san)) &&
    opt(m.insight, (i) => isObj(i) && isStr(i.motif))
  );
}

function isEval(e: unknown): boolean {
  return isObj(e) && isStr(e.fen) && isNum(e.depth) && Array.isArray(e.lines) && isObj(e.score);
}

/**
 * Pages read the stored report without checking it. A report of the current version is checked in full; an older
 * version is rebuilt from its evaluations, so only what the rebuild needs (start position, moves, evals) is required.
 */
function isReport(r: unknown): boolean {
  if (!isObj(r) || !isNum(r.version) || !isStr(r.startFen) || !Array.isArray(r.moves) || !Array.isArray(r.evals)) return false;
  if (!r.evals.every(isEval)) return false;
  if (r.version !== REPORT_VERSION) return true;
  return (
    r.moves.every(isMove) && r.evals.length === r.moves.length + 1 &&
    isSide(r.accuracy) && isSide(r.ratingAccuracy) && isSide(r.estimatedRating) && isSide(r.acpl) &&
    isObj(r.advanced) && isSide(r.advanced.opening) && isSide(r.advanced.tactics) && isSide(r.advanced.strategy) && isSide(r.advanced.endgame) &&
    isObj(r.counts) && isObj(r.counts.white) && isObj(r.counts.black) &&
    isObj(r.phases) && PHASES.every((p) => isSide((r.phases as Rec)[p])) &&
    Array.isArray(r.keyMoments) && r.keyMoments.every(isNum) &&
    (r.opening === null || (isObj(r.opening) && isStr(r.opening.eco) && isStr(r.opening.name) && isNum(r.opening.ply)))
  );
}

function isAnalysis(r: unknown): boolean {
  return (
    isObj(r) && isStr(r.gameKey) && isNum(r.analysedAt) && oneOf(r.engine, ENGINES) && isNum(r.depth) && isReport(r.report) &&
    opt(r.engineBuild, isStr)
  );
}

function isOpeningLine(r: unknown): boolean {
  return (
    isObj(r) && isStr(r.id) && isStr(r.family) && (r.color === 'w' || r.color === 'b') && isBox(r.box) && isNum(r.due) &&
    opt(r.lastAt, isNum) && isNum(r.misses)
  );
}

const SPECS: { [T in Exclude<TableName, 'kv'>]: { valid: (r: unknown) => boolean; key: (r: TableRows[T]) => string | number } } = {
  attempts: { valid: isAttempt, key: (r) => r.id as number },
  daily: { valid: isDaily, key: (r) => r.date },
  rushRuns: { valid: isRushRun, key: (r) => r.id as number },
  battles: { valid: isBattle, key: (r) => r.id as number },
  customPuzzles: { valid: isCustomPuzzle, key: (r) => r.id },
  reviews: { valid: isReview, key: (r) => r.puzzleId },
  achievements: { valid: isAchievement, key: (r) => r.id },
  games: { valid: isGame, key: (r) => r.key },
  analyses: { valid: isAnalysis, key: (r) => r.gameKey },
  openingLines: { valid: isOpeningLine, key: (r) => r.id },
};

/** A known kv value is checked; other keys pass through (their readers sanitise: settings, analysisPrefs, recentOpponents, endgameProgress, visionBest, openingFamilies). */
function kvValueOk(key: string, v: unknown): boolean {
  switch (key) {
    case 'puzzleRating':
      return isObj(v) && isNum(v.rating) && isNum(v.rd) && isNum(v.vol);
    case 'puzzleStreak':
      return isObj(v) && isNum(v.current) && isNum(v.best) && v.current >= 0 && v.best >= 0;
    case 'battleRating':
      return isNum(v);
    case 'playerName':
      return isStr(v) && v.trim().length >= 2 && v.trim().length <= 20;
    case 'reviewCursor':
      return isNum(v) && v >= 0;
    case 'achievementsSeeded':
      return isBool(v);
    default:
      return true;
  }
}

/* ---------- parse ---------- */

const NOT_BACKUP = 'This file is not a Knightfall backup.';
const NEWER = 'This backup was made by a newer version of Knightfall. Reload the page and try again.';

export function parseBackup(text: string, currentDbVersion: number): ParseResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'That file is too large to be a Knightfall backup.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON, so it cannot be a Knightfall backup.' };
  }
  if (!isObj(raw)) return { ok: false, error: NOT_BACKUP };
  if (raw.format === CUSTOM_EXPORT_FORMAT) {
    return { ok: false, error: 'This is a custom puzzles export, not a progress backup. Import it from the Custom Puzzles page instead.' };
  }
  if (raw.format !== BACKUP_FORMAT || !isNum(raw.version) || !isNum(raw.dbVersion)) return { ok: false, error: NOT_BACKUP };
  if (raw.version > BACKUP_VERSION || raw.dbVersion > currentDbVersion) return { ok: false, error: NEWER };
  if (!isObj(raw.tables)) return { ok: false, error: 'This backup has no data in it.' };
  const src = raw.tables;
  for (const name of BACKUP_TABLES) {
    if (src[name] !== undefined && !Array.isArray(src[name])) return { ok: false, error: `This backup is damaged (the "${name}" data is not a list).` };
  }

  let skipped = 0;
  const tables = {} as CleanBackup['tables'];

  for (const name of BACKUP_TABLES) {
    if (name === 'kv') continue;
    const spec = SPECS[name] as { valid: (r: unknown) => boolean; key: (r: unknown) => string | number };
    const seen = new Set<string | number>();
    const rows: unknown[] = [];
    for (const row of (src[name] as unknown[] | undefined) ?? []) {
      if (!spec.valid(row)) {
        skipped++;
        continue;
      }
      const k = spec.key(row);
      if (seen.has(k)) {
        skipped++;
        continue;
      }
      seen.add(k);
      rows.push(row);
    }
    (tables as Record<string, unknown[]>)[name] = rows;
  }

  const kv: KV[] = [];
  const seenKeys = new Set<string>();
  for (const row of (src.kv as unknown[] | undefined) ?? []) {
    if (!isObj(row) || !isStr(row.key)) {
      skipped++;
      continue;
    }
    if (isDeviceKey(row.key)) continue;
    if (seenKeys.has(row.key) || !kvValueOk(row.key, row.value)) {
      skipped++;
      continue;
    }
    seenKeys.add(row.key);
    kv.push(row as unknown as KV);
  }

  // The review scan starts above reviewCursor: a cursor past the newest attempt would hide new attempts forever,
  // and a missing one would re-ingest every old miss.
  const maxAttemptId = tables.attempts.reduce((m, a) => Math.max(m, a.id ?? 0), 0);
  const ci = kv.findIndex((r) => r.key === 'reviewCursor');
  if (ci >= 0) kv[ci] = { key: 'reviewCursor', value: Math.min(kv[ci].value as number, maxAttemptId) };
  else if (maxAttemptId > 0) kv.push({ key: 'reviewCursor', value: maxAttemptId });
  tables.kv = kv;

  if (BACKUP_TABLES.every((n) => tables[n].length === 0)) {
    return { ok: false, error: skipped ? 'This backup has no readable progress in it.' : 'This backup is empty.' };
  }

  const rating = kv.find((r) => r.key === 'puzzleRating')?.value as { rating: number } | undefined;
  const name = kv.find((r) => r.key === 'playerName')?.value;
  const summary: BackupSummary = {
    exportedAt: isStr(raw.exportedAt) ? raw.exportedAt : '',
    playerName: isStr(name) ? name : null,
    puzzleRating: rating ? Math.round(rating.rating) : null,
    attempts: tables.attempts.length,
    battles: tables.battles.length,
    games: tables.games.length,
    customPuzzles: tables.customPuzzles.length,
    skipped,
  };
  return { ok: true, backup: { exportedAt: summary.exportedAt, dbVersion: raw.dbVersion, tables }, summary };
}
