import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@knightfall/core';
import type { Participant } from './participant.ts';
import { Room } from './room.ts';

function fake(id: string): Participant & { inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  return { id, isBot: false, info: { name: id, rating: 1200 }, inbox, send: (m) => inbox.push(m) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('Room reconnect support', () => {
  const make = () => {
    const a = fake('a');
    const b = fake('b');
    const room = new Room({ id: 'rr', seed: 5, players: [a, b], countdownMs: 3000, durationMs: 60_000, extras: [{ opponentCode: 'BBBBBB' }, { opponentCode: 'AAAAAA' }] });
    room.start();
    vi.advanceTimersByTime(3000);
    return { a, b, room };
  };

  it('replacePlayer swaps a seat and routes messages to the new participant', () => {
    const { b, room } = make();
    const a2 = fake('a2');
    expect(room.replacePlayer('a', a2)).toBe(true);
    expect(room.replacePlayer('zzz', a2)).toBe(false);
    room.progress('b', { index: 0, solved: 1, strikes: 0 });
    expect(a2.inbox.at(-1)).toMatchObject({ type: 'opponent-progress', solved: 1 });
    expect(room.progress('a2', { index: 0, solved: 1, strikes: 0 })).toBe(true);
    expect(b.inbox.at(-1)).toMatchObject({ type: 'opponent-progress' });
  });

  it('resumeMessages: matched with both scores, then start; plus end once the battle is over', () => {
    const { room } = make();
    room.progress('a', { index: 0, solved: 1, strikes: 0 });
    const msgs = room.resumeMessages('a');
    expect(msgs.map((m) => m.type)).toEqual(['matched', 'start']);
    expect(msgs[0]).toMatchObject({ roomId: 'rr', seed: 5, opponentCode: 'BBBBBB', resume: { me: { solved: 1, strikes: 0 }, opp: { solved: 0, strikes: 0 } } });
    vi.advanceTimersByTime(60_000);
    expect(room.resumeMessages('a').map((m) => m.type)).toEqual(['matched', 'start', 'end']);
    expect(room.resumeMessages('a').at(-1)).toMatchObject({ result: 'win', reason: 'time' });
    expect(room.resumeMessages('b').at(-1)).toMatchObject({ result: 'loss', reason: 'time' });
  });

  it('enforces the gap between one player results', () => {
    const { room } = make();
    expect(room.progress('a', { index: 0, solved: 1, strikes: 0 })).toBe(true);
    vi.advanceTimersByTime(100);
    expect(room.progress('a', { index: 1, solved: 2, strikes: 0 })).toBe(false);
    vi.advanceTimersByTime(150);
    expect(room.progress('a', { index: 1, solved: 2, strikes: 0 })).toBe(true);
    // The other player is not held up by it.
    expect(room.progress('b', { index: 0, solved: 1, strikes: 0 })).toBe(true);
  });

  it('a timer callback that throws does not escape', () => {
    const a = fake('a');
    const b = fake('b');
    const room = new Room({
      id: 'rx',
      seed: 1,
      players: [a, b],
      countdownMs: 0,
      durationMs: 1000,
      onEnd: () => {
        throw new Error('bad room');
      },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    room.start();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
