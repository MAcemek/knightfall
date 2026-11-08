import { describe, expect, it } from 'vitest';
import { battleReducer, initialBattleState, tugShare, type BattleState, type EndInfo } from './battleState.ts';

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

  it('tug share is balanced when level and leans toward the leader', () => {
    expect(tugShare(0, 0)).toBe(0.5);
    expect(tugShare(5, 2)).toBeGreaterThan(0.5);
    expect(tugShare(2, 5)).toBeLessThan(0.5);
  });
});
