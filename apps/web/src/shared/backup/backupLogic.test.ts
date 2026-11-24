import { describe, expect, it } from 'vitest';
import { REPORT_VERSION } from '@knightfall/core';
import { db } from '../db.ts';
import { BACKUP_FORMAT, BACKUP_TABLES, BACKUP_VERSION, DEVICE_KEYS, backupFileName, buildBackup, parseBackup, type TableName } from './backupLogic.ts';

const DB_VERSION = 4;

const move = (ply: number) => ({
  ply, color: ply % 2 === 0 ? 'w' : 'b', moveNumber: Math.floor(ply / 2) + 1, san: 'e4', uci: 'e2e4',
  fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  class: 'best', phase: 'opening', winBefore: 50, winAfter: 51, epLoss: 0, accuracy: 100, cpLoss: 0, best: { uci: 'e2e4', san: 'e4' },
  insight: { motif: 'fork' },
});
const evalOf = (i: number) => ({ fen: `fen ${i}`, depth: 12, source: 'engine', lines: [{ score: { cp: 20 }, pv: ['e2e4'] }], score: { cp: 20 } });
const side = { white: 90, black: null };
const report = {
  version: REPORT_VERSION, startFen: 'startpos', moves: [move(0)], evals: [evalOf(0), evalOf(1)],
  accuracy: side, ratingAccuracy: side, estimatedRating: side, acpl: side,
  advanced: { opening: side, tactics: side, strategy: side, endgame: side },
  counts: { white: { best: 1 }, black: {} }, phases: { opening: side, middlegame: side, endgame: side },
  keyMoments: [0], opening: { eco: 'B00', name: 'King pawn', ply: 1 },
};

function rows(): Record<TableName, unknown[]> {
  return {
    kv: [
      { key: 'puzzleRating', value: { rating: 1543.6, rd: 80, vol: 0.06 } },
      { key: 'puzzleStreak', value: { current: 2, best: 9 } },
      { key: 'battleRating', value: 1310 },
      { key: 'playerName', value: 'SwiftKnight42' },
      { key: 'settings', value: { sound: false } },
      { key: 'openingFamilies', value: ['Sicilian Defense'] },
      { key: 'reviewCursor', value: 2 },
      { key: 'achievementsSeeded', value: true },
      { key: 'battleCode', value: 'ABCD' },
      { key: 'battleToken', value: 'secret' },
      { key: 'ratedPending', value: { puzzleId: 'x', puzzleRating: 1500, at: 1 } },
    ],
    attempts: [
      { id: 1, puzzleId: 'p1', mode: 'rated', solved: false, puzzleRating: 1500, ratingBefore: 1500, ratingAfter: 1490, delta: -10, hintsUsed: 0, timeMs: 5000, at: 1700000000000, themes: ['fork'] },
      { id: 2, puzzleId: 'p2', mode: 'rush', solved: true, puzzleRating: 1400, hintsUsed: 1, timeMs: 3000, at: 1700000001000 },
      { id: 5, puzzleId: 'p3', mode: 'daily', solved: true, puzzleRating: 1450, hintsUsed: 0, timeMs: 3000, at: 1700000002000 },
    ],
    daily: [{ date: '2026-11-20', puzzleId: 'd1', solved: true, clean: true, at: 1700000000000, solvedLate: false }],
    rushRuns: [{ id: 1, mode: '3min', score: 12, strikes: 3, bestCombo: 5, highestRating: 1600, puzzles: [{ id: 'p1', rating: 1500, solved: true }], at: 1700000000000 }],
    battles: [
      { id: 1, at: 1700000000000, result: 'win', reason: 'time', opponentName: 'Rival', opponentRating: 1250, you: { solved: 8, strikes: 1 }, opponent: { solved: 6, strikes: 3 }, ratingBefore: 1200, ratingAfter: 1216 },
      {
        id: 2, at: 1700000100000, result: 'draw', reason: 'time', opponentName: 'Friend', opponentRating: 1200, you: { solved: 5, strikes: 2 }, opponent: { solved: 5, strikes: 2 },
        ratingBefore: 1216, ratingAfter: 1216, friendly: true, opponentCode: 'WXYZ', settings: { durationMs: 180000, level: 'normal' },
        series: { length: 3, game: 1, me: 0.5, opp: 0.5 }, club: { place: 2, players: 4 },
      },
    ],
    customPuzzles: [
      { id: 'c-1', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', moves: ['a1a2'], opponentFirst: false, rating: 1500, themes: ['endgame'], source: 'custom', createdAt: 1, updatedAt: 2, title: 'T', author: 'Me', plays: 3, solves: 2, alts: { 0: ['a1b1'] } },
    ],
    reviews: [{ puzzleId: 'p1', puzzleRating: 1500, themes: ['fork'], box: 1, due: 1700000500000, addedAt: 1700000000000, lastAt: null, lapses: 1, reps: 0 }],
    achievements: [{ id: 'first-solve', at: 1700000000000 }],
    games: [
      {
        key: 'li-abcd1234', source: 'lichess', url: 'https://lichess.org/abcd1234', pgn: '1. e4 e5 *', white: { name: 'Me', rating: 1500 }, black: { name: 'Rival', title: 'FM' },
        result: '1-0', playedAt: 1700000000000, importedAt: 1700000001000, plies: 2, speed: 'blitz', timeControl: '180+0', opening: { eco: 'C20', name: 'King pawn' },
        siteAccuracy: { white: 90, black: 80 }, importedFor: 'me',
      },
    ],
    analyses: [{ gameKey: 'li-abcd1234', analysedAt: 1700000002000, engine: 'lite', depth: 12, report, engineBuild: 'sf17' }],
    openingLines: [{ id: 'line-1', family: 'Sicilian Defense', color: 'b', box: 2, due: 1700000000000, lastAt: 1699990000000, misses: 1 }],
  };
}

const NOW = '2026-11-23T10:00:00.000Z';
const wrap = (tables: Partial<Record<TableName, unknown[]>>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, dbVersion: DB_VERSION, exportedAt: NOW, tables, ...extra });
const parse = (text: string) => parseBackup(text, DB_VERSION);

describe('backup tables', () => {
  it('lists exactly the tables of db.ts', () => {
    expect([...BACKUP_TABLES].sort()).toEqual(db.tables.map((t) => t.name).sort());
  });
});

describe('buildBackup', () => {
  it('drops device keys and keeps every other kv row', () => {
    const file = buildBackup(rows(), DB_VERSION, NOW);
    const keys = file.tables.kv.map((r) => (r as { key: string }).key);
    for (const k of DEVICE_KEYS) expect(keys).not.toContain(k);
    expect(keys).toContain('openingFamilies');
    expect(file).toMatchObject({ format: BACKUP_FORMAT, version: BACKUP_VERSION, dbVersion: DB_VERSION, exportedAt: NOW });
  });
});

describe('parseBackup', () => {
  it('round-trips every table through JSON', () => {
    const src = rows();
    const r = parse(JSON.stringify(buildBackup(src, DB_VERSION, NOW)));
    if (!r.ok) throw new Error(r.error);
    for (const name of BACKUP_TABLES) {
      if (name === 'kv') continue;
      expect(r.backup.tables[name]).toEqual(src[name]);
    }
    expect(r.summary.skipped).toBe(0);
    const kvKeys = r.backup.tables.kv.map((x) => x.key).sort();
    expect(kvKeys).toEqual(['achievementsSeeded', 'battleRating', 'openingFamilies', 'playerName', 'puzzleRating', 'puzzleStreak', 'reviewCursor', 'settings']);
  });

  it('ignores device keys found in a file', () => {
    const r = parse(wrap({ kv: rows().kv, attempts: rows().attempts }));
    if (!r.ok) throw new Error(r.error);
    const keys = r.backup.tables.kv.map((x) => x.key);
    for (const k of DEVICE_KEYS) expect(keys).not.toContain(k);
    expect(r.summary.skipped).toBe(0);
  });

  it('keeps unknown kv keys', () => {
    const r = parse(wrap({ kv: [{ key: 'someFutureThing', value: { a: 1 } }, { key: 'battleRating', value: 1200 }] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.tables.kv).toContainEqual({ key: 'someFutureThing', value: { a: 1 } });
  });

  it('refuses a newer db version and a newer format version', () => {
    const a = parse(wrap({ kv: rows().kv }, { dbVersion: DB_VERSION + 1 }));
    const b = parse(wrap({ kv: rows().kv }, { version: BACKUP_VERSION + 1 }));
    for (const r of [a, b]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('newer version of Knightfall. Reload the page and try again.');
    }
  });

  it('gives friendly errors for non-JSON, wrong format and custom exports', () => {
    const notJson = parse('hello');
    const wrongFormat = parse(JSON.stringify({ format: 'other', version: 1 }));
    const array = parse('[1,2]');
    const custom = parse(JSON.stringify({ format: 'knightfall-custom-puzzles', version: 1, puzzles: [] }));
    expect(notJson.ok || notJson.error).toMatch(/not valid JSON/);
    expect(wrongFormat.ok || wrongFormat.error).toMatch(/not a Knightfall backup/);
    expect(array.ok || array.error).toMatch(/not a Knightfall backup/);
    expect(custom.ok || custom.error).toMatch(/custom puzzles/);
  });

  it('rejects missing tables and tables that are not lists; treats a missing table as empty', () => {
    expect(parse(JSON.stringify({ format: BACKUP_FORMAT, version: 1, dbVersion: DB_VERSION })).ok).toBe(false);
    expect(parse(wrap({ attempts: {} as unknown as unknown[], kv: rows().kv })).ok).toBe(false);
    const r = parse(wrap({ kv: rows().kv }));
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.tables.games).toEqual([]);
    expect(r.backup.tables.openingLines).toEqual([]);
  });

  it('ignores unknown extra tables', () => {
    const r = parse(wrap({ kv: rows().kv, mystery: [{ a: 1 }] } as never));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.backup.tables).sort()).toEqual([...BACKUP_TABLES].sort());
  });

  it('skips a battle without "you" and counts it', () => {
    const [good, bad] = [rows().battles[0], { ...(rows().battles[1] as object), you: undefined }];
    const r = parse(wrap({ battles: [good, bad], kv: rows().kv }));
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.tables.battles).toEqual([good]);
    expect(r.summary.skipped).toBe(1);
    expect(r.summary.battles).toBe(1);
  });

  it('skips bad enums, ids and nested fields', () => {
    const a = rows().attempts[0] as Record<string, unknown>;
    const bad = [
      { ...a, id: 10, mode: 'blitz' },
      { ...a, id: 0 },
      { ...a, id: 1.5 },
      { ...a, id: 11, puzzleRating: NaN },
      { ...a, id: 12, themes: 'fork' },
      { ...a, id: 13, timeMs: '5' },
      null,
      'x',
    ];
    const r = parse(wrap({ attempts: [a, ...bad], kv: [] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.tables.attempts).toEqual([a]);
    expect(r.summary.skipped).toBe(bad.length);
  });

  it('keeps the first row of a duplicate primary key', () => {
    const a = rows().attempts[0] as Record<string, unknown>;
    const r = parse(wrap({ attempts: [a, { ...a, puzzleId: 'other' }] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.tables.attempts).toEqual([a]);
    expect(r.summary.skipped).toBe(1);
  });

  it('drops kv values of the wrong type and keeps good ones', () => {
    const r = parse(
      wrap({
        kv: [
          { key: 'puzzleRating', value: { rating: 'high', rd: 80, vol: 0.06 } },
          { key: 'battleRating', value: null },
          { key: 'puzzleStreak', value: { current: -1, best: 3 } },
          { key: 'playerName', value: 'A' },
          { key: 'achievementsSeeded', value: 'yes' },
          { key: 'puzzleStreak', value: { current: 1, best: 3 } },
          { key: 7, value: 1 },
        ],
        daily: rows().daily,
      }),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.tables.kv).toEqual([{ key: 'puzzleStreak', value: { current: 1, best: 3 } }]);
    expect(r.summary.skipped).toBe(6);
    expect(r.summary.puzzleRating).toBeNull();
  });

  it('rejects a NaN rating serialised as null', () => {
    const r = parse(wrap({ kv: [{ key: 'puzzleRating', value: JSON.parse('{"rating":null,"rd":1,"vol":1}') }] }));
    expect(r.ok).toBe(false);
  });

  it('clamps reviewCursor to the largest attempt id and fills it when missing', () => {
    const attempts = rows().attempts; // largest id 5
    const clamped = parse(wrap({ attempts, kv: [{ key: 'reviewCursor', value: 900 }] }));
    const filled = parse(wrap({ attempts, kv: [{ key: 'battleRating', value: 1200 }] }));
    const kept = parse(wrap({ attempts, kv: [{ key: 'reviewCursor', value: 2 }] }));
    const none = parse(wrap({ daily: rows().daily, kv: [{ key: 'reviewCursor', value: 7 }] }));
    const cursor = (r: ReturnType<typeof parse>) => (r.ok ? r.backup.tables.kv.find((x) => x.key === 'reviewCursor')?.value : 'error');
    expect(cursor(clamped)).toBe(5);
    expect(cursor(filled)).toBe(5);
    expect(cursor(kept)).toBe(2);
    expect(cursor(none)).toBe(0);
  });

  it('accepts an older report version without the new fields but rejects a broken current one', () => {
    const old = { gameKey: 'g-old', analysedAt: 1, engine: 'deep', depth: 20, report: { version: 1, startFen: 's', moves: [], evals: [evalOf(0)] } };
    const broken = { ...(rows().analyses[0] as object), gameKey: 'g-bad', report: { ...report, counts: undefined } };
    const noEvals = { ...(rows().analyses[0] as object), gameKey: 'g-bad2', report: { ...report, evals: [] } };
    const r = parse(wrap({ analyses: [old, broken, noEvals] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.tables.analyses).toEqual([old]);
    expect(r.summary.skipped).toBe(2);
  });

  it('rejects a file with no valid row at all', () => {
    expect(parse(wrap({ attempts: [{ id: 1 }] })).ok).toBe(false);
    expect(parse(wrap({})).ok).toBe(false);
  });

  it('builds the summary', () => {
    const r = parse(JSON.stringify(buildBackup(rows(), DB_VERSION, NOW)));
    if (!r.ok) throw new Error(r.error);
    expect(r.summary).toEqual({
      exportedAt: NOW, playerName: 'SwiftKnight42', puzzleRating: 1544, attempts: 3, battles: 2, games: 1, customPuzzles: 1, skipped: 0,
    });
  });
});

describe('backupFileName', () => {
  it('uses the local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('knightfall-backup-2026-01-05.json');
    expect(backupFileName(new Date(2026, 10, 23))).toBe('knightfall-backup-2026-11-23.json');
  });
});
