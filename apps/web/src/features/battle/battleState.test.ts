import { describe, expect, it } from 'vitest';
import { battleReducer, initialBattleState, introTagline, missingProgress, ratingAfterBattle, resignText, seriesAfter, seriesText, tugShare, type BattleState, type EndInfo } from './battleState.ts';

const me = { name: 'Me', rating: 1200 };
const run = (s: BattleState, ...actions: Parameters<typeof battleReducer>[1][]) => actions.reduce(battleReducer, s);

const matched = () =>
  run(
    initialBattleState,
    { type: 'connecting' },
    { type: 'search-started', at: 1 },
    { type: 'server', me, msg: { type: 'queued', position: 1 } },
    { type: 'server', me, msg: { type: 'matched', roomId: 'r1', seed: 7, opponent: { name: 'Op', rating: 1250 } } },
    { type: 'server', me, msg: { type: 'start', startsAt: 100, endsAt: 200, serverNow: 50 } },
  );

const end: EndInfo = { result: 'win', reason: 'time', you: { solved: 2, strikes: 0 }, opponent: { solved: 1, strikes: 1 }, ratingBefore: 1200, ratingAfter: 1217, endedAt: 1 };

describe('battleReducer', () => {
  it('walks lobby -> searching -> matched with start times', () => {
    const s = matched();
    expect(s.phase).toBe('matched');
    expect(s.match).toMatchObject({ roomId: 'r1', seed: 7, startsAt: 100, endsAt: 200, me });
  });

  it('records my results only while playing and stops after 3 strikes', () => {
    let s = battleReducer(matched(), { type: 'my-result', puzzle: { id: 'a', rating: 500 }, solved: true });
    expect(s.me.solved).toBe(0);
    s = battleReducer(s, { type: 'go' });
    s = run(
      s,
      { type: 'my-result', puzzle: { id: 'a', rating: 500 }, solved: true },
      { type: 'my-result', puzzle: { id: 'b', rating: 540 }, solved: false },
      { type: 'my-result', puzzle: { id: 'c', rating: 580 }, solved: false },
      { type: 'my-result', puzzle: { id: 'd', rating: 620 }, solved: false },
      { type: 'my-result', puzzle: { id: 'e', rating: 660 }, solved: true },
    );
    expect(s.me).toEqual({ solved: 1, strikes: 3 });
    expect(s.history.map((h) => h.solved)).toEqual([true, false, false, false]);
  });

  it('tracks opponent progress and bumps the pop tick', () => {
    const s = run(matched(), { type: 'go' }, { type: 'server', me, msg: { type: 'opponent-progress', solved: 1, strikes: 0, index: 0 } });
    expect(s.opp).toEqual({ solved: 1, strikes: 0 });
    expect(s.oppTick).toBe(1);
  });

  it('handles rematch offers, acceptance and the opponent leaving', () => {
    let s = run(matched(), { type: 'go' }, { type: 'ended', end });
    expect(s.phase).toBe('ended');
    s = battleReducer(s, { type: 'server', me, msg: { type: 'rematch-offered' } });
    expect(s.rematch).toBe('offered');
    s = battleReducer(s, { type: 'rematch-requested' });
    expect(s.rematch).toBe('requested');
    s = battleReducer(s, { type: 'server', me, msg: { type: 'opponent-left' } });
    expect(s.rematch).toBe('unavailable');
    s = battleReducer(s, { type: 'server', me, msg: { type: 'matched', roomId: 'r2', seed: 9, opponent: { name: 'Op', rating: 1250 } } });
    expect(s).toMatchObject({ phase: 'matched', rematch: 'none', history: [], end: null });
  });

  it('a lost connection mid-battle returns to the lobby with an error', () => {
    const s = battleReducer(battleReducer(matched(), { type: 'go' }), { type: 'connection-lost' });
    expect(s.phase).toBe('lobby');
    expect(s.error).toMatch(/lost/i);
  });

  it('marks a friend challenge match as friendly and keeps random matches unmarked', () => {
    const friendly = battleReducer(initialBattleState, { type: 'server', me, msg: { type: 'matched', roomId: 'f1', seed: 1, opponent: { name: 'Pal', rating: 1100 }, friendly: true } });
    expect(friendly).toMatchObject({ phase: 'matched', match: { roomId: 'f1', friendly: true } });
    expect(matched().match?.friendly).toBeUndefined();
    // A rematch of a casual battle arrives flagged again; a random one does not inherit the flag.
    const next = battleReducer(friendly, { type: 'server', me, msg: { type: 'matched', roomId: 'f2', seed: 2, opponent: { name: 'Pal', rating: 1100 } } });
    expect(next.match?.friendly).toBeUndefined();
  });

  it('friendly battles leave the rating alone, random ones use Elo', () => {
    const m = { me, opponent: { name: 'Op', rating: 1250 } };
    expect(ratingAfterBattle({ ...m, friendly: true }, 'win')).toBe(1200);
    expect(ratingAfterBattle({ ...m, friendly: true }, 'loss')).toBe(1200);
    expect(ratingAfterBattle(m, 'win')).toBeGreaterThan(1200);
    expect(ratingAfterBattle(m, 'loss')).toBeLessThan(1200);
  });

  it('tug share is balanced when level and leans toward the leader', () => {
    expect(tugShare(0, 0)).toBe(0.5);
    expect(tugShare(5, 2)).toBeGreaterThan(0.5);
    expect(tugShare(2, 5)).toBeLessThan(0.5);
  });
});

describe('matched extras', () => {
  it('carries opponentCode, settings and series into the match', () => {
    const settings = { durationMs: 60_000 as const, level: 'harder' as const };
    const series = { length: 3 as const, game: 1, me: 0, opp: 0 };
    const s = battleReducer(initialBattleState, {
      type: 'server', me, msg: { type: 'matched', roomId: 'r', seed: 1, opponent: { name: 'Op', rating: 1 }, friendly: true, opponentCode: 'ABCDEF', settings, series },
    });
    expect(s.match).toMatchObject({ friendly: true, opponentCode: 'ABCDEF', settings, series });
  });
  it('leaves them out for a plain match', () => {
    expect(matched().match).not.toHaveProperty('settings');
  });
});

describe('series', () => {
  const s = (game: number, me: number, opp: number) => ({ length: 3 as const, game, me, opp });
  it('scores wins and draws and settles at 2 points or 3 games', () => {
    expect(seriesAfter(s(1, 0, 0), 'win', 'time')).toMatchObject({ me: 1, opp: 0, over: false });
    expect(seriesAfter(s(2, 1, 0), 'win', 'time')).toMatchObject({ me: 2, over: true });
    expect(seriesAfter(s(2, 0.5, 1), 'loss', 'time')).toMatchObject({ opp: 2, over: true });
    expect(seriesAfter(s(3, 1, 1), 'draw', 'time')).toMatchObject({ me: 1.5, opp: 1.5, over: true });
    expect(seriesAfter(s(1, 0, 0), 'win', 'opponent-left').over).toBe(true);
  });
  it('words the state', () => {
    expect(seriesText({ ...s(1, 1, 0), over: false }, 'time', 5)).toBe('Game 1 of 3 · You lead 1–0 · next game in 5…');
    expect(seriesText({ ...s(2, 0, 1), over: false }, 'time', 0)).toBe('Game 2 of 3 · Opponent leads 0–1 · next game in 0…');
    expect(seriesText({ ...s(3, 2, 1), over: true }, 'time', 0)).toBe('You won the series 2–1');
    expect(seriesText({ ...s(3, 1, 2), over: true }, 'time', 0)).toBe('You lost the series 1–2');
    expect(seriesText({ ...s(1, 1, 0), over: true }, 'opponent-left', 0)).toBe('Your opponent left · series ended 1–0');
  });
});

describe('introTagline and resignText', () => {
  const st = { durationMs: 60_000 } as Parameters<typeof introTagline>[0];
  it('words the duration from settings and adds the game number', () => {
    expect(introTagline()).toBe('Same puzzles. Three minutes. Three strikes.');
    expect(introTagline({ ...st!, durationMs: 60_000 })).toBe('Same puzzles. One minute. Three strikes.');
    expect(introTagline({ ...st!, durationMs: 300_000 })).toBe('Same puzzles. Five minutes. Three strikes.');
    expect(introTagline({ ...st!, durationMs: 180_000 }, { game: 2, length: 3, me: 1, opp: 0 } as never)).toBe('Same puzzles. Three minutes. Three strikes. Game 2 of 3.');
  });
  it('warns that resigning ends a series', () => {
    expect(resignText(true, { game: 1, length: 3, me: 0, opp: 0 } as never)).toContain('ends the whole series');
    expect(resignText(true)).toContain('casual battle');
    expect(resignText(false)).toContain('rating drops');
  });
});

describe('reconnecting mid-battle', () => {
  const playing = () =>
    run(
      matched(),
      { type: 'go' },
      { type: 'my-result', puzzle: { id: 'a', rating: 500 }, solved: true },
      { type: 'my-result', puzzle: { id: 'b', rating: 540 }, solved: false },
      { type: 'server', me, msg: { type: 'opponent-progress', solved: 1, strikes: 0, index: 0 } },
    );

  it('keeps the match while reconnecting, and gives up with the old abandoned message', () => {
    const s = battleReducer(playing(), { type: 'reconnecting', at: 500 });
    expect(s).toMatchObject({ phase: 'playing', reconnectingSince: 500, me: { solved: 1, strikes: 1 } });
    const gone = battleReducer(s, { type: 'connection-lost' });
    expect(gone.phase).toBe('lobby');
    expect(gone.error).toMatch(/abandoned/);
    expect(gone.reconnectingSince).toBe(0);
  });

  it('only matches and playing phases can be reconnecting, and only the first drop counts', () => {
    expect(battleReducer(initialBattleState, { type: 'reconnecting', at: 1 })).toBe(initialBattleState);
    const s = battleReducer(playing(), { type: 'reconnecting', at: 500 });
    expect(battleReducer(s, { type: 'reconnecting', at: 900 })).toBe(s);
  });

  it('a resume matched for the same room keeps my progress and takes the server score of the opponent', () => {
    const s = battleReducer(playing(), { type: 'reconnecting', at: 500 });
    const back = battleReducer(s, {
      type: 'server', me,
      msg: { type: 'matched', roomId: 'r1', seed: 7, opponent: { name: 'Op', rating: 1250 }, resume: { me: { solved: 1, strikes: 0 }, opp: { solved: 3, strikes: 1 } } },
    });
    expect(back).toMatchObject({ phase: 'playing', reconnectingSince: 0, me: { solved: 1, strikes: 1 }, opp: { solved: 3, strikes: 1 } });
    expect(back.history).toHaveLength(2);
    expect(back.match).toMatchObject({ roomId: 'r1', startsAt: 100 });
  });

  it('a matched for another room starts fresh even when it carries resume', () => {
    const s = battleReducer(playing(), { type: 'reconnecting', at: 500 });
    const next = battleReducer(s, {
      type: 'server', me,
      msg: { type: 'matched', roomId: 'r2', seed: 9, opponent: { name: 'Op', rating: 1250 }, resume: { me: { solved: 0, strikes: 0 }, opp: { solved: 0, strikes: 0 } } },
    });
    expect(next).toMatchObject({ phase: 'matched', reconnectingSince: 0, history: [], me: { solved: 0 } });
  });

  it('shows and clears the opponent-away state', () => {
    let s = battleReducer(playing(), { type: 'server', me, msg: { type: 'opponent-away', graceMs: 15_000 } });
    expect(s.oppAway).toBe(true);
    s = battleReducer(s, { type: 'server', me, msg: { type: 'opponent-back' } });
    expect(s.oppAway).toBe(false);
    expect(battleReducer(initialBattleState, { type: 'server', me, msg: { type: 'opponent-away', graceMs: 1 } })).toBe(initialBattleState);
    const away = battleReducer(playing(), { type: 'server', me, msg: { type: 'opponent-away', graceMs: 15_000 } });
    expect(battleReducer(away, { type: 'ended', end }).oppAway).toBe(false);
  });

  it('missingProgress lists the results the server has not seen, with cumulative counts', () => {
    const h = [
      { id: 'a', rating: 500, solved: true },
      { id: 'b', rating: 540, solved: false },
      { id: 'c', rating: 580, solved: true },
      { id: 'd', rating: 620, solved: true },
    ];
    expect(missingProgress(h, { solved: 1, strikes: 1 })).toEqual([
      { index: 2, solved: 2, strikes: 1 },
      { index: 3, solved: 3, strikes: 1 },
    ]);
    expect(missingProgress(h, { solved: 3, strikes: 1 })).toEqual([]);
    expect(missingProgress(h, { solved: 0, strikes: 0 })).toHaveLength(4);
    expect(missingProgress([], { solved: 0, strikes: 0 })).toEqual([]);
  });
});
