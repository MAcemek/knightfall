import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@knightfall/core';
import type { Participant } from './participant.ts';
import { Room } from './room.ts';
import { BattleHub, Session } from './hub.ts';

function fake(id: string, rating = 1200): Participant & { inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  return { id, isBot: false, info: { name: id, rating }, inbox, send: (m) => inbox.push(m) };
}

const ends = (p: { inbox: ServerMessage[] }) => p.inbox.filter((m): m is Extract<ServerMessage, { type: 'end' }> => m.type === 'end');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('Room', () => {
  const make = () => {
    const a = fake('a');
    const b = fake('b');
    const onEnd = vi.fn();
    const room = new Room({ id: 'r', seed: 42, players: [a, b], onEnd, countdownMs: 3000, durationMs: 60_000 });
    room.start();
    return { a, b, room, onEnd };
  };

  it('sends matched then start to both players', () => {
    const { a, b } = make();
    expect(a.inbox.map((m) => m.type)).toEqual(['matched', 'start']);
    expect(b.inbox[0]).toMatchObject({ type: 'matched', seed: 42, opponent: { name: 'a' } });
    expect(a.inbox[1]).toMatchObject({ type: 'start', startsAt: 1_003_000, endsAt: 1_063_000, serverNow: 1_000_000 });
  });

  it('ignores progress during the countdown and forwards it afterwards', () => {
    const { a, b, room } = make();
    expect(room.progress('a', { index: 0, solved: 1, strikes: 0 })).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(room.progress('a', { index: 0, solved: 1, strikes: 0 })).toBe(true);
    expect(b.inbox.at(-1)).toEqual({ type: 'opponent-progress', solved: 1, strikes: 0, index: 0 });
    expect(a.inbox.some((m) => m.type === 'opponent-progress')).toBe(false);
  });

  it('ends on time with results from each perspective', () => {
    const { a, b, room, onEnd } = make();
    vi.advanceTimersByTime(3000);
    room.progress('a', { index: 0, solved: 1, strikes: 0 });
    vi.advanceTimersByTime(60_000);
    expect(ends(a)).toEqual([{ type: 'end', result: 'win', reason: 'time', you: { solved: 1, strikes: 0 }, opponent: { solved: 0, strikes: 0 } }]);
    expect(ends(b)[0]).toMatchObject({ result: 'loss', reason: 'time' });
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('ends early when a struck-out player is already behind', () => {
    const { a, b, room } = make();
    vi.advanceTimersByTime(3000);
    room.progress('b', { index: 0, solved: 1, strikes: 0 });
    room.progress('a', { index: 0, solved: 0, strikes: 1 });
    room.progress('a', { index: 1, solved: 0, strikes: 2 });
    expect(room.ended).toBe(false);
    room.progress('a', { index: 2, solved: 0, strikes: 3 });
    expect(room.ended).toBe(true);
    expect(ends(a)[0]).toMatchObject({ result: 'loss', reason: 'strikes' });
    expect(ends(b)[0]).toMatchObject({ result: 'win', reason: 'strikes' });
  });

  it('keeps going when the struck-out player leads, then ends when both are out (draw)', () => {
    const { a, b, room } = make();
    vi.advanceTimersByTime(3000);
    room.progress('a', { index: 0, solved: 1, strikes: 0 });
    for (let i = 1; i <= 3; i++) room.progress('a', { index: i, solved: 1, strikes: i });
    expect(room.ended).toBe(false);
    room.progress('b', { index: 0, solved: 1, strikes: 0 });
    for (let i = 1; i <= 3; i++) room.progress('b', { index: i, solved: 1, strikes: i });
    expect(room.ended).toBe(true);
    expect(ends(a)[0]).toMatchObject({ result: 'draw', reason: 'strikes' });
    expect(ends(b)[0]).toMatchObject({ result: 'draw', reason: 'strikes' });
  });

  it('awards the win to the remaining player when the other leaves', () => {
    const { a, b, room } = make();
    vi.advanceTimersByTime(3000);
    room.progress('a', { index: 0, solved: 1, strikes: 0 });
    room.leave('a');
    expect(ends(b)[0]).toMatchObject({ result: 'win', reason: 'opponent-left' });
    expect(ends(a)).toEqual([]);
    vi.advanceTimersByTime(120_000);
    expect(ends(b)).toHaveLength(1);
  });
});

describe('BattleHub', () => {
  const session = () => {
    const inbox: ServerMessage[] = [];
    const s = new Session((m) => inbox.push(m));
    return { s, inbox };
  };

  it('pairs two close-rated players immediately', () => {
    const hub = new BattleHub();
    const x = session();
    const y = session();
    hub.handle(x.s, { type: 'queue', player: { name: 'X', rating: 1200 } });
    expect(x.inbox[0]).toEqual({ type: 'queued', position: 1 });
    hub.handle(y.s, { type: 'queue', player: { name: 'Y', rating: 1250 } });
    expect(x.inbox.map((m) => m.type)).toEqual(['queued', 'matched', 'start']);
    expect(y.inbox.find((m) => m.type === 'matched')).toMatchObject({ opponent: { name: 'X', rating: 1200 } });
    hub.stop();
  });

  it('falls back to a bot after waiting, and the bot plays', () => {
    const hub = new BattleHub();
    const x = session();
    hub.handle(x.s, { type: 'queue', player: { name: 'X', rating: 1500 } });
    hub.tick(Date.now() + 7000);
    expect(x.inbox.some((m) => m.type === 'matched')).toBe(false);
    vi.advanceTimersByTime(8000);
    hub.tick();
    const matched = x.inbox.find((m) => m.type === 'matched');
    expect(matched).toMatchObject({ opponent: { name: expect.stringMatching(/^Bot · /) } });
    vi.advanceTimersByTime(3000 + 12_000);
    expect(x.inbox.some((m) => m.type === 'opponent-progress')).toBe(true);
    hub.stop();
  });

  it('starts a rematch when both ask, and tells the other when one leaves', () => {
    const hub = new BattleHub();
    const x = session();
    const y = session();
    hub.handle(x.s, { type: 'queue', player: { name: 'X', rating: 1200 } });
    hub.handle(y.s, { type: 'queue', player: { name: 'Y', rating: 1200 } });
    vi.advanceTimersByTime(3000 + 180_000);
    expect(x.inbox.some((m) => m.type === 'end')).toBe(true);
    hub.handle(x.s, { type: 'rematch' });
    expect(y.inbox.at(-1)).toEqual({ type: 'rematch-offered' });
    hub.handle(y.s, { type: 'rematch' });
    expect(x.inbox.slice(-2).map((m) => m.type)).toEqual(['matched', 'start']);

    vi.advanceTimersByTime(3000 + 180_000);
    hub.handle(y.s, { type: 'leave' });
    expect(x.inbox.at(-1)).toEqual({ type: 'opponent-left' });
    hub.stop();
  });

  it('rematches against a bot automatically', () => {
    const hub = new BattleHub();
    const x = session();
    hub.handle(x.s, { type: 'queue', player: { name: 'X', rating: 900 } });
    vi.advanceTimersByTime(8000);
    hub.tick();
    vi.advanceTimersByTime(3000 + 180_000);
    expect(x.inbox.some((m) => m.type === 'end')).toBe(true);
    const before = x.inbox.filter((m) => m.type === 'matched').length;
    hub.handle(x.s, { type: 'rematch' });
    vi.advanceTimersByTime(3000);
    expect(x.inbox.filter((m) => m.type === 'matched').length).toBe(before + 1);
    hub.stop();
  });

  it('a disconnect mid-game gives the opponent the win', () => {
    const hub = new BattleHub();
    const x = session();
    const y = session();
    hub.handle(x.s, { type: 'queue', player: { name: 'X', rating: 1200 } });
    hub.handle(y.s, { type: 'queue', player: { name: 'Y', rating: 1200 } });
    vi.advanceTimersByTime(5000);
    hub.disconnect(y.s);
    expect(x.inbox.at(-1)).toMatchObject({ type: 'end', result: 'win', reason: 'opponent-left' });
    hub.stop();
  });
});
