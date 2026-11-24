import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { TbCategory, TbMove } from '../../shared/tablebase.ts';
import { failureMessage, goalReached, judgeUserMove, OFFLINE_MESSAGE, pickDefence, recordSolve, sanitizeProgress, solvedCount } from './endgameLogic.ts';

const mv = (uci: string, category: TbCategory, dtm: number | null = null, dtz: number | null = null): TbMove => ({ uci, san: uci, category, dtm, dtz });

describe('pickDefence', () => {
  it('returns null when there is no move', () => {
    expect(pickDefence([])).toBeNull();
  });

  it('a losing side prolongs: the longest distance to mate', () => {
    const moves = [mv('a', 'loss', 4), mv('b', 'loss', 12), mv('c', 'loss', 8)];
    expect(pickDefence(moves)?.uci).toBe('b');
  });

  it('falls back to dtz when there is no dtm', () => {
    const moves = [mv('a', 'loss', null, 3), mv('b', 'loss', null, 9), mv('c', 'loss', null, 5)];
    expect(pickDefence(moves)?.uci).toBe('b');
  });

  it('a drawing side keeps the draw', () => {
    const moves = [mv('a', 'loss', 4), mv('b', 'draw', 0, 0), mv('c', 'loss', 6)];
    expect(pickDefence(moves)?.uci).toBe('b');
  });

  it('the first of several drawing moves is played', () => {
    expect(pickDefence([mv('x', 'draw'), mv('y', 'draw')])?.uci).toBe('x');
  });

  it('a drawing side with the board does not give its last pawn away', () => {
    // Blockade: d6+ is also "a draw", but Kxd6 ends the drill at once.
    const c = new Chess('8/2k5/8/3P4/3K4/8/8/8 w - - 2 2');
    const draws = ['d5d6', 'd4c5', 'd4e5', 'd4c4'].map((u) => mv(u, 'draw'));
    expect(pickDefence(draws, c)?.uci).not.toBe('d5d6');
  });

  it('a drawing side avoids stalemate and pawn pushes while it has another try', () => {
    const c = new Chess('7k/8/6KP/8/8/8/8/5B2 w - - 0 1');
    expect(pickDefence([mv('h6h7', 'draw'), mv('f1e2', 'draw')], c)?.uci).toBe('f1e2');
  });

  it('a drawing side tries something new instead of repeating', () => {
    const c = new Chess('8/8/8/4k3/8/1b6/8/R3K3 w - - 0 1');
    for (const u of ['a1b1', 'b3a2', 'b1a1', 'a2b3']) c.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
    expect(pickDefence([mv('a1b1', 'draw'), mv('a1a3', 'draw')], c)?.uci).toBe('a1a3');
  });

  it('a winning side takes the quickest win', () => {
    const moves = [mv('a', 'draw'), mv('b', 'win', -9), mv('c', 'win', -3)];
    expect(pickDefence(moves)?.uci).toBe('c');
  });

  it('ranks a cursed win above a draw and below a win', () => {
    expect(pickDefence([mv('a', 'draw'), mv('b', 'cursed-win', null, -80)])?.uci).toBe('b');
    expect(pickDefence([mv('a', 'cursed-win', null, -80), mv('b', 'win', null, -20)])?.uci).toBe('b');
  });
});

describe('judgeUserMove', () => {
  it('a win must stay a win', () => {
    expect(judgeUserMove('win', 'win')).toEqual({ ok: true });
    expect(judgeUserMove('win', 'draw')).toEqual({ ok: false, message: "That lets it slip: it's now a draw" });
    expect(judgeUserMove('win', 'cursed-win')).toMatchObject({ ok: false });
    expect(judgeUserMove('win', 'maybe-win')).toMatchObject({ ok: false });
    expect(judgeUserMove('win', 'loss')).toEqual({ ok: false, message: "That lets it slip: it's now lost" });
    expect(judgeUserMove('win', 'unknown')).toMatchObject({ ok: false });
  });

  it('a draw must not become a loss', () => {
    expect(judgeUserMove('draw', 'draw')).toEqual({ ok: true });
    expect(judgeUserMove('draw', 'blessed-loss')).toEqual({ ok: true });
    expect(judgeUserMove('draw', 'loss')).toEqual({ ok: false, message: "That lets it slip: it's now lost" });
    expect(judgeUserMove('draw', 'maybe-loss')).toMatchObject({ ok: false });
  });
});

describe('goalReached', () => {
  const play = (fen: string, ...sans: string[]) => {
    const c = new Chess(fen);
    for (const s of sans) c.move(s);
    return c;
  };

  it('a win is reached at checkmate only', () => {
    const mated = new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
    expect(mated.isCheckmate()).toBe(true);
    expect(goalReached('win', mated, 5, undefined)).toBe(true);
    expect(goalReached('win', new Chess('8/8/8/4k3/8/8/2Q5/4K3 w - - 0 1'), 40, 3)).toBe(false);
  });

  it('a draw is reached by stalemate', () => {
    const stale = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(stale.isStalemate()).toBe(true);
    expect(goalReached('draw', stale, 1, 20)).toBe(true);
  });

  it('a draw is reached by insufficient material', () => {
    expect(goalReached('draw', new Chess('8/8/8/4k3/8/8/8/4KB2 w - - 0 1'), 1, 20)).toBe(true);
  });

  it('a draw is reached by threefold repetition', () => {
    const c = play('7k/8/5K2/7P/8/8/8/8 b - - 0 1', 'Kg8', 'Ke6', 'Kh8', 'Kf6', 'Kg8', 'Ke6', 'Kh8', 'Kf6');
    expect(c.isThreefoldRepetition()).toBe(true);
    expect(goalReached('draw', c, 4, 20)).toBe(true);
  });

  it('a draw is reached after holding for N moves', () => {
    const c = new Chess('7k/8/5K2/7P/8/8/8/8 b - - 0 1');
    expect(goalReached('draw', c, 7, 8)).toBe(false);
    expect(goalReached('draw', c, 8, 8)).toBe(true);
  });

  it('a draw without a hold count only ends with the game', () => {
    expect(goalReached('draw', new Chess('7k/8/5K2/7P/8/8/8/8 b - - 0 1'), 99, undefined)).toBe(false);
  });
});

describe('progress', () => {
  it('sanitizes stored data', () => {
    expect(sanitizeProgress(null)).toEqual({});
    expect(sanitizeProgress('x')).toEqual({});
    expect(sanitizeProgress({ kqk: { solved: true, best: 12 }, bad: { solved: 'yes' }, krk: { solved: true, best: -3 }, neg: 4 })).toEqual({
      kqk: { solved: true, best: 12 },
    });
  });

  it('records a solve and keeps the best (lowest) move count', () => {
    let p = recordSolve({}, 'kqk', 14);
    expect(p).toEqual({ kqk: { solved: true, best: 14 } });
    p = recordSolve(p, 'kqk', 20);
    expect(p.kqk?.best).toBe(14);
    p = recordSolve(p, 'kqk', 11);
    expect(p.kqk?.best).toBe(11);
  });

  it('does not change the input', () => {
    const p = { a: { solved: true, best: 5 } };
    recordSolve(p, 'b', 3);
    expect(p).toEqual({ a: { solved: true, best: 5 } });
  });

  it('counts solved ids in a list', () => {
    const p = { a: { solved: true, best: 5 }, b: { solved: true, best: 9 } };
    expect(solvedCount(p, ['a', 'c', 'b'])).toBe(2);
    expect(solvedCount({}, ['a'])).toBe(0);
  });
});

describe('copy', () => {
  it('has the offline message', () => {
    expect(OFFLINE_MESSAGE).toBe('Endgame drills need an internet connection');
    expect(failureMessage('offline')).toBe(OFFLINE_MESSAGE);
    expect(failureMessage('rate-limited')).toContain('busy');
    expect(failureMessage('bad-response')).not.toContain('internet');
  });
});
