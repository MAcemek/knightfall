import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { parsePgnGame } from '@knightfall/core';
import type { RatingLogRow } from '../../shared/db.ts';
import { userSide } from '../../shared/analysis/side.ts';
import {
  allTicked, applyMove, botMoveContext, canMate, clockNow, defaultElo, detectOutcome, flagged, flagOutcome, formatClock, latestRapidRating, mindText, moveRows,
  NO_TICKS, outcomeFor, pastGameRow, pause, pgnClock, recordCheck, resign, resolveColor, resultText, resume, sanitizeBotGame, snapElo,
  startGame, thinkMs, timeOut, toPgn, toSaved, toStoredGame, toggleTick, TIME_CONTROLS, type BotGame, type Side,
} from './playLogic.ts';

const T0 = 1_700_000_000_000;

function fresh(over: Partial<{ you: Side; base: number; inc: number; elo: number }> = {}): BotGame {
  return resume(startGame({ id: 'g1', now: T0, base: 900_000, inc: 10_000, you: 'w', elo: 1650, ...over }), T0);
}

/** Play uci moves one second apart. */
function play(g: BotGame, ucis: string[], step = 1000): BotGame {
  let t = g.turnStartedAt ?? T0;
  let cur = g;
  for (const u of ucis) {
    t += step;
    const r = applyMove(cur, u, t);
    if (r.kind !== 'moved') throw new Error(`move ${u} was ${r.kind}`);
    cur = r.state;
  }
  return cur;
}

describe('time controls', () => {
  it('has 15+10 and 30+0', () => {
    expect(TIME_CONTROLS.map((t) => [t.base, t.inc])).toEqual([[900_000, 10_000], [1_800_000, 0]]);
  });
});

describe('clocks', () => {
  it('start paused and only run after resume', () => {
    const s = startGame({ id: 'x', now: T0, base: 60_000, inc: 0, you: 'w', elo: 1500 });
    expect(s.status).toBe('paused');
    expect(clockNow(s, 'w', T0 + 5000)).toBe(60_000);
    const r = resume(s, T0);
    expect(clockNow(r, 'w', T0 + 5000)).toBe(55_000);
    expect(clockNow(r, 'b', T0 + 5000)).toBe(60_000);
  });

  it('adds the increment and passes the turn', () => {
    const g = fresh();
    const r = applyMove(g, 'e2e4', T0 + 4000);
    expect(r.kind).toBe('moved');
    if (r.kind !== 'moved') return;
    expect(r.state.clocks.w).toBe(900_000 - 4000 + 10_000);
    expect(r.state.moves[0]).toEqual({ uci: 'e2e4', san: 'e4', clk: 906_000 });
    expect(r.state.turnStartedAt).toBe(T0 + 4000);
    expect(clockNow(r.state, 'b', T0 + 6000)).toBe(898_000);
    expect(clockNow(r.state, 'w', T0 + 6000)).toBe(906_000);
  });

  it('rejects an illegal move and a move in a paused game', () => {
    const g = fresh();
    expect(applyMove(g, 'e2e5', T0 + 1).kind).toBe('illegal');
    expect(applyMove(pause(g, T0 + 10), 'e2e4', T0 + 20).kind).toBe('illegal');
  });

  it('pause freezes the clock and resume continues from it', () => {
    const g = fresh();
    const p = pause(g, T0 + 7000);
    expect(p.status).toBe('paused');
    expect(p.turnStartedAt).toBeNull();
    expect(p.clocks.w).toBe(893_000);
    expect(clockNow(p, 'w', T0 + 99_000)).toBe(893_000);
    const r = resume(p, T0 + 50_000);
    expect(clockNow(r, 'w', T0 + 52_000)).toBe(891_000);
  });

  it('finds a flag', () => {
    const g = fresh({ base: 5000, inc: 0 });
    expect(flagged(g, T0 + 4999)).toBeNull();
    expect(flagged(g, T0 + 5000)).toBe('w');
  });

  it('a move that arrives after the time ran out loses on time and is not played', () => {
    const g = fresh({ base: 5000, inc: 0 });
    const r = applyMove(g, 'e2e4', T0 + 6000);
    expect(r.kind).toBe('flagged');
    expect(r.state.status).toBe('over');
    expect(r.state.result).toBe('0-1');
    expect(r.state.reason).toBe('time');
    expect(r.state.moves).toHaveLength(0);
    expect(r.state.clocks.w).toBe(0);
  });

  it('plays no more moves after the game is over', () => {
    const g = resign(fresh(), T0 + 1000);
    expect(applyMove(g, 'e2e4', T0 + 2000).kind).toBe('illegal');
  });

  it('the saved copy is paused with the clock as it stands', () => {
    const g = fresh();
    const s = toSaved(g, T0 + 3000);
    expect(s.status).toBe('paused');
    expect(s.clocks.w).toBe(897_000);
    expect(g.status).toBe('playing');
  });
});

describe('game end', () => {
  it('detects checkmate for the side that moved', () => {
    const g = play(fresh(), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(g.status).toBe('over');
    expect(g.result).toBe('0-1');
    expect(g.reason).toBe('checkmate');
    expect(g.turnStartedAt).toBeNull();
  });

  it('detects stalemate', () => {
    // A quick known stalemate line.
    const moves = ['e2e3', 'a7a5', 'd1h5', 'a8a6', 'h5a5', 'h7h5', 'h2h4', 'a6h6', 'a5c7', 'f7f6', 'c7d7', 'e8f7', 'd7b7', 'd8d3', 'b7b8', 'd3h7', 'b8c8', 'f7g6', 'c8e6'];
    const g = play(fresh(), moves);
    expect(g.reason).toBe('stalemate');
    expect(g.result).toBe('1/2-1/2');
  });

  it('detects threefold repetition', () => {
    const g = play(fresh(), ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
    expect(g.reason).toBe('repetition');
    expect(g.result).toBe('1/2-1/2');
  });

  it('detects the 50-move rule', () => {
    const chess = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
    expect(detectOutcome(chess)).toBeNull();
    chess.move('Rb1');
    expect(detectOutcome(chess)).toEqual({ result: '1/2-1/2', reason: 'fifty' });
  });

  it('resign gives the win to the bot and stops the clock', () => {
    const g = resign(fresh(), T0 + 2000);
    expect(g.result).toBe('0-1');
    expect(g.reason).toBe('resign');
    expect(g.clocks.w).toBe(898_000);
    const b = resign(fresh({ you: 'b' }), T0 + 2000);
    expect(b.result).toBe('1-0');
  });
});

describe('flag with too little material', () => {
  const chessOf = (fen: string) => new Chess(fen);
  it('knows when a side cannot mate', () => {
    expect(canMate(chessOf('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'w')).toBe(false);
    expect(canMate(chessOf('4k3/8/8/8/8/8/8/3BK3 w - - 0 1'), 'w')).toBe(false);
    expect(canMate(chessOf('4k3/8/8/8/8/8/8/3NK3 w - - 0 1'), 'w')).toBe(false);
    expect(canMate(chessOf('4k3/8/8/8/8/8/8/2NNK3 w - - 0 1'), 'w')).toBe(false);
    expect(canMate(chessOf('4k3/8/8/8/8/8/8/2BBK3 w - - 0 1'), 'w')).toBe(true);
    // Two bishops on the same colour cannot mate.
    expect(canMate(chessOf('4k3/8/8/8/8/B7/8/2B1K3 w - - 0 1'), 'w')).toBe(false);
    expect(canMate(chessOf('4k3/8/8/8/8/8/8/2BNK3 w - - 0 1'), 'w')).toBe(true);
    expect(canMate(chessOf('4k3/8/8/8/8/8/7P/3NK3 w - - 0 1'), 'w')).toBe(true);
    expect(canMate(chessOf('4k3/8/8/8/8/8/8/3QK3 w - - 0 1'), 'w')).toBe(true);
  });

  it('a flag in a normal position is a loss', () => {
    const g = timeOut(fresh(), 'w');
    expect(g.result).toBe('0-1');
    expect(g.reason).toBe('time');
  });

  it('a flag is a draw when the other side has only a king, one minor piece, two knights or same-coloured bishops', () => {
    expect(flagOutcome(new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'b')).toEqual({ result: '1-0', reason: 'time' });
    expect(flagOutcome(new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'w')).toEqual({ result: '1/2-1/2', reason: 'timeDraw' });
    expect(flagOutcome(new Chess('4k3/8/8/8/8/8/8/3NK3 w - - 0 1'), 'b')).toEqual({ result: '1/2-1/2', reason: 'timeDraw' });
    expect(flagOutcome(new Chess('4k3/8/8/8/8/8/8/2NNK3 w - - 0 1'), 'b')).toEqual({ result: '1/2-1/2', reason: 'timeDraw' });
    expect(flagOutcome(new Chess('4k3/8/8/8/8/B7/8/2B1K3 w - - 0 1'), 'b')).toEqual({ result: '1/2-1/2', reason: 'timeDraw' });
    expect(flagOutcome(new Chess('4k3/8/8/8/8/8/8/2BBK3 w - - 0 1'), 'b')).toEqual({ result: '1-0', reason: 'time' });
    // Whatever the flagging side has, the draw rule looks only at the other side.
    expect(flagOutcome(new Chess('k7/p7/8/8/8/8/8/KN6 b - - 0 1'), 'b')).toEqual({ result: '1/2-1/2', reason: 'timeDraw' });
    expect(flagOutcome(new Chess('k7/n7/8/8/8/8/8/KN6 b - - 0 1'), 'b')).toEqual({ result: '1/2-1/2', reason: 'timeDraw' });
    expect(flagOutcome(new Chess('k7/p7/8/8/8/8/8/KR6 b - - 0 1'), 'b')).toEqual({ result: '1-0', reason: 'time' });
  });
});

describe('thinkMs', () => {
  const base = { clockMs: 900_000, incMs: 10_000, legalMoves: 30, ply: 20, recapture: false, rand: 0.5 };
  it('one legal move takes about 0.8 s', () => {
    expect(thinkMs({ ...base, legalMoves: 1 })).toBe(800);
  });
  it('the first 8 plies take 1.5 to 4 s', () => {
    expect(thinkMs({ ...base, ply: 2, rand: 0 })).toBe(1500);
    expect(thinkMs({ ...base, ply: 2, rand: 0.999999 })).toBeLessThanOrEqual(4000);
    expect(thinkMs({ ...base, ply: 2, rand: 0.999999 })).toBeGreaterThan(3990);
  });
  it('later moves scale with the clock, the increment and the random factor', () => {
    const slow = thinkMs({ ...base, rand: 0.999999 });
    const quick = thinkMs({ ...base, rand: 0 });
    expect(quick).toBe(Math.round((900_000 / 40 + 6000) * 0.4));
    expect(slow).toBeGreaterThan(quick);
    expect(slow).toBeLessThanOrEqual(20_000);
  });
  it('is capped at 20 s', () => {
    expect(thinkMs({ ...base, clockMs: 36_000_000, rand: 0.999999 })).toBeLessThanOrEqual(20_000);
  });
  it('a recapture takes about a third', () => {
    const full = thinkMs(base);
    expect(thinkMs({ ...base, recapture: true })).toBe(Math.round(full / 3));
  });
  it('never takes more than an eighth of the clock', () => {
    expect(thinkMs({ ...base, clockMs: 8000, rand: 0.999999 })).toBe(1000);
  });
  it('takes at least half a second unless the clock is under 3 s', () => {
    expect(thinkMs({ ...base, clockMs: 3000, incMs: 0, rand: 0, recapture: true })).toBe(500);
    expect(thinkMs({ ...base, clockMs: 2000, incMs: 0, rand: 0 })).toBe(20);
  });
});

describe('botMoveContext', () => {
  it('sees a recapture and counts legal moves', () => {
    const g = play(fresh(), ['e2e4', 'd7d5', 'e4d5']);
    const c = botMoveContext(g);
    expect(c.recapture).toBe(true);
    expect(c.ply).toBe(3);
    expect(c.legalMoves).toBeGreaterThan(1);
    expect(botMoveContext(play(fresh(), ['e2e4'])).recapture).toBe(false);
  });
});

describe('saving', () => {
  it('a running game comes back paused with the saved clocks', () => {
    const g = play(fresh(), ['e2e4', 'e7e5']);
    const saved = JSON.parse(JSON.stringify(toSaved(g, g.turnStartedAt! + 3000))) as unknown;
    const back = sanitizeBotGame({ ...(saved as object), status: 'playing', turnStartedAt: 123 });
    expect(back).not.toBeNull();
    expect(back!.status).toBe('paused');
    expect(back!.turnStartedAt).toBeNull();
    expect(back!.clocks.w).toBe(g.clocks.w - 3000);
    expect(back!.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('refuses damaged data', () => {
    const g = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    expect(sanitizeBotGame(g)).not.toBeNull();
    expect(sanitizeBotGame(null)).toBeNull();
    expect(sanitizeBotGame('x')).toBeNull();
    expect(sanitizeBotGame({ ...g, id: '' })).toBeNull();
    expect(sanitizeBotGame({ ...g, you: 'x' })).toBeNull();
    expect(sanitizeBotGame({ ...g, base: Number.NaN })).toBeNull();
    expect(sanitizeBotGame({ ...g, clocks: { w: 1, b: Infinity } })).toBeNull();
    expect(sanitizeBotGame({ ...g, clocks: { w: -1, b: 1 } })).toBeNull();
    expect(sanitizeBotGame({ ...g, checks: { shown: 1.5, changed: 0 } })).toBeNull();
    expect(sanitizeBotGame({ ...g, checks: undefined })).toBeNull();
    expect(sanitizeBotGame({ ...g, moves: [{ uci: 'e2e5', san: 'e5', clk: 5 }] })).toBeNull();
    expect(sanitizeBotGame({ ...g, moves: [{ uci: 'e2e4', san: 'e4', clk: Number.NaN }] })).toBeNull();
    expect(sanitizeBotGame({ ...g, moves: 'no' })).toBeNull();
    expect(sanitizeBotGame({ ...g, status: 'over', result: '1-0' })).toBeNull();
  });

  it('refuses a game whose moves already end it', () => {
    const over = play(fresh(), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(sanitizeBotGame({ ...JSON.parse(JSON.stringify(over)), status: 'playing', result: null })).toBeNull();
  });

  it('keeps the level inside the range', () => {
    expect(sanitizeBotGame({ ...JSON.parse(JSON.stringify(fresh())), elo: 99_999 })!.elo).toBe(3190);
  });
});

describe('checks', () => {
  it('count shown and changed', () => {
    let g = fresh();
    g = recordCheck(recordCheck(g, 'shown'), 'changed');
    expect(g.checks).toEqual({ shown: 1, changed: 1 });
  });
  it('need all three ticks and toggle one at a time', () => {
    let t = NO_TICKS;
    expect(allTicked(t)).toBe(false);
    t = toggleTick(toggleTick(t, 'checks'), 'captures');
    expect(allTicked(t)).toBe(false);
    t = toggleTick(t, 'threats');
    expect(allTicked(t)).toBe(true);
    expect(allTicked(toggleTick(t, 'checks'))).toBe(false);
  });
  it('says how often you changed your mind', () => {
    expect(mindText({ shown: 0, changed: 3 })).toBeNull();
    expect(mindText({ shown: 31, changed: 2 })).toBe('You changed your mind 2 times in 31 moves');
    expect(mindText({ shown: 1, changed: 1 })).toBe('You changed your mind 1 time in 1 move');
  });
});

describe('words and clocks', () => {
  it('formats clocks', () => {
    expect(formatClock(899_000)).toBe('14:59');
    expect(formatClock(9400)).toBe('0:09.4');
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(Number.NaN)).toBe('0:00.0');
  });
  it('tells the result from your side', () => {
    expect(outcomeFor('1-0', 'w')).toBe('win');
    expect(outcomeFor('1-0', 'b')).toBe('loss');
    expect(outcomeFor('1/2-1/2', 'b')).toBe('draw');
    expect(outcomeFor('*', 'w')).toBeNull();
    expect(resultText({ result: '0-1', reason: 'checkmate', you: 'w' })).toBe('You lost by checkmate');
    expect(resultText({ result: '1-0', reason: 'time', you: 'w' })).toBe('You won on time');
    expect(resultText({ result: '1/2-1/2', reason: 'stalemate', you: 'w' })).toBe('Draw by stalemate');
  });
  it('lists moves in rows', () => {
    expect(moveRows([{ san: 'e4' }, { san: 'e5' }, { san: 'Nf3' }])).toEqual([{ n: 1, w: 'e4', b: 'e5' }, { n: 2, w: 'Nf3', b: null }]);
  });
  it('picks the colour', () => {
    expect(resolveColor('w', 0.9)).toBe('w');
    expect(resolveColor('random', 0.2)).toBe('w');
    expect(resolveColor('random', 0.7)).toBe('b');
  });
});

describe('level', () => {
  const row = (date: string, rating: number, speed: RatingLogRow['speed'] = 'rapid'): RatingLogRow => ({ id: `chesscom-${speed}-${date}`, date, site: 'chesscom', speed, rating });
  it('uses the newest rapid rating', () => {
    expect(latestRapidRating([row('2026-01-01', 1400), row('2026-02-01', 1500, 'blitz'), row('2026-03-01', 1450)])).toBe(1450);
    expect(latestRapidRating([row('2026-02-01', 1500, 'blitz')])).toBeNull();
    expect(latestRapidRating(undefined)).toBeNull();
  });
  it('rounds to ten and stays in range', () => {
    expect(defaultElo(1654)).toBe(1650);
    expect(defaultElo(900)).toBe(1320);
    expect(defaultElo(3500)).toBe(3190);
    expect(defaultElo(null)).toBe(1500);
    expect(snapElo(1652)).toBe(1650);
    expect(snapElo(10)).toBe(1320);
  });
});

describe('pgn', () => {
  function finished(you: Side = 'w'): BotGame {
    // Scholar's mate style game; every move one second after the last.
    const g = play(fresh({ you }), ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    return g;
  }
  it('writes a clock after every move and parses back with all clocks and the result', () => {
    const g = finished();
    expect(g.result).toBe('1-0');
    const pgn = toPgn(g, { w: 'Player', b: 'Training bot (about 1650)' }, { w: 1500 }, g.result!, new Date(T0));
    expect(pgn).toContain('[TimeControl "900+10"]');
    expect(pgn).toContain('[Event "Knightfall bot game"]');
    expect(pgn).toContain('[Termination "Normal"]');
    expect(pgn).toContain('[WhiteElo "1500"]');
    expect(pgn).not.toContain('BlackElo');
    const parsed = parsePgnGame(pgn);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.game.sans).toHaveLength(7);
    expect(parsed.game.result).toBe('1-0');
    expect(parsed.game.clocksMs.every((c) => c !== null)).toBe(true);
    expect(parsed.game.clocksMs[0]).toBe(Math.floor(g.moves[0].clk / 100) * 100);
  });
  it('formats a clock comment', () => {
    expect(pgnClock(906_000)).toBe('0:15:06.0');
    expect(pgnClock(3_723_450)).toBe('1:02:03.4');
    expect(pgnClock(-5)).toBe('0:00:00.0');
  });
  it('writes a time forfeit', () => {
    const g = timeOut(fresh(), 'w');
    expect(toPgn(g, { w: 'A', b: 'B' }, {}, g.result!, new Date(T0))).toContain('[Termination "Time forfeit"]');
  });
});

describe('stored game', () => {
  const finished = (you: Side) => play(fresh({ you }), ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);

  it('is keyed by the game and found on the right side', () => {
    for (const you of ['w', 'b'] as const) {
      const s = toStoredGame(finished(you), 'Quiet Fox', 1500, T0 + 5000)!;
      expect(s.key).toBe('bot-g1');
      expect(s.source).toBe('bot');
      expect(s.speed).toBe('rapid');
      expect(s.timeControl).toBe('900+10');
      expect(s.plies).toBe(7);
      expect(s.playedAt).toBe(T0);
      expect(s.importedFor).toBe('quiet fox');
      expect(userSide(s)).toBe(you);
      const mine = you === 'w' ? s.white : s.black;
      const bot = you === 'w' ? s.black : s.white;
      expect(mine.rating).toBe(1500);
      expect(bot.name).toBe('Training bot (about 1650)');
      expect(bot.rating).toBeUndefined();
      expect(parsePgnGame(s.pgn).ok).toBe(true);
    }
  });

  it('leaves the rating out when it is not known', () => {
    const s = toStoredGame(finished('w'), 'Quiet Fox', null, T0)!;
    expect(s.white.rating).toBeUndefined();
    expect(s.pgn).not.toContain('WhiteElo');
  });

  it('gives the bot another name when the player picked the same one', () => {
    const s = toStoredGame(finished('w'), 'training BOT (about 1650)', null, T0)!;
    expect(s.black.name).toBe('Training bot (about 1650) 2');
    expect(userSide(s)).toBe('w');
  });

  it('keeps odd characters out of the headers', () => {
    const s = toStoredGame(finished('w'), 'Ann "the" \\ Knight', null, T0)!;
    expect(parsePgnGame(s.pgn).ok).toBe(true);
    expect(userSide(s)).toBe('w');
  });

  it('stores nothing for a game that is short or not over', () => {
    const short = resign(play(fresh(), ['e2e4']), T0 + 5000);
    expect(toStoredGame(short, 'Quiet Fox', null, T0)).toBeNull();
    expect(toStoredGame(play(fresh(), ['e2e4', 'e7e5']), 'Quiet Fox', null, T0)).toBeNull();
    const ok = resign(play(fresh(), ['e2e4', 'e7e5']), T0 + 5000);
    expect(toStoredGame(ok, 'Quiet Fox', null, T0)).not.toBeNull();
  });

  it('is the same stored game when built twice', () => {
    const g = finished('w');
    expect(toStoredGame(g, 'Quiet Fox', 1500, 5)).toEqual(toStoredGame(g, 'Quiet Fox', 1500, 5));
  });
});

describe('past games', () => {
  it('reads outcome and level from a stored game', () => {
    const g = play(fresh({ you: 'b' }), ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    const s = toStoredGame(g, 'Quiet Fox', null, T0)!;
    const row = pastGameRow(s, userSide(s));
    expect(row).toEqual({ key: 'bot-g1', outcome: 'loss', level: 1650, playedAt: T0 });
    expect(pastGameRow(s, null).outcome).toBeNull();
  });
});
