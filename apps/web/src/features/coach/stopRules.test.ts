import { describe, expect, it } from 'vitest';
import {
  blitzSession, bulletThisWeek, mergeActivity, sanitizeActivity, sanitizeNotes, withNote, withoutLastNote, type ActivityGame, type ActivityResult,
} from './stopRules.ts';

const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0).getTime();
const game = (n: number, time: number, speed: 'blitz' | 'bullet', result: ActivityResult = 'win'): ActivityGame => ({ key: `cc-live-${n}`, at: time, speed, result });

describe('sanitizeActivity', () => {
  const now = at(2026, 11, 20);
  it('returns an empty record for junk', () => {
    expect(sanitizeActivity(null, now)).toEqual({ user: '', lastSync: null, games: [] });
    expect(sanitizeActivity([], now)).toEqual({ user: '', lastSync: null, games: [] });
    expect(sanitizeActivity({ games: 5, lastSync: 'x' }, now)).toEqual({ user: '', lastSync: null, games: [] });
  });
  it('prunes to 35 days and drops bad rows and repeated keys', () => {
    const rows = [
      game(1, at(2026, 11, 19), 'blitz'),
      game(2, at(2026, 10, 1), 'blitz'),
      { key: 'x', at: 'no', speed: 'blitz', result: 'win' },
      { key: 'cc-live-3', at: at(2026, 11, 18), speed: 'rapid', result: 'win' },
      game(1, at(2026, 11, 19, 13), 'blitz', 'loss'),
    ];
    const a = sanitizeActivity({ user: ' Sample ', lastSync: 5, games: rows }, now);
    expect(a.user).toBe('sample');
    expect(a.lastSync).toBe(5);
    expect(a.games).toHaveLength(1);
    expect(a.games[0]).toMatchObject({ key: 'cc-live-1', result: 'loss' });
  });
  it('keeps the newest 2000', () => {
    const rows = Array.from({ length: 2100 }, (_, i) => game(i, at(2026, 11, 19) + i * 1000, 'blitz'));
    const a = sanitizeActivity({ games: rows }, now);
    expect(a.games).toHaveLength(2000);
    expect(a.games[a.games.length - 1].key).toBe('cc-live-2099');
    expect(a.games[0].key).toBe('cc-live-100');
  });
});

describe('mergeActivity', () => {
  const now = at(2026, 11, 20);
  it('adds by key and is the same after a second merge', () => {
    const old = { user: 'sample', lastSync: 1, games: [game(1, at(2026, 11, 19), 'blitz')] };
    const fresh = [game(1, at(2026, 11, 19), 'blitz'), game(2, at(2026, 11, 19, 13), 'bullet')];
    const once = mergeActivity(old, fresh, 'Sample', now);
    expect(once.games.map((g) => g.key)).toEqual(['cc-live-1', 'cc-live-2']);
    expect(mergeActivity(once, fresh, 'Sample', now)).toEqual(once);
  });
  it('starts again for another user', () => {
    const old = { user: 'other', lastSync: 1, games: [game(1, at(2026, 11, 19), 'blitz')] };
    expect(mergeActivity(old, [], 'Sample', now).games).toEqual([]);
  });
});

describe('bulletThisWeek', () => {
  // 2026-11-18 is a Wednesday; its Monday is 2026-11-16.
  const today = '2026-11-18';
  const bullets = (n: number, day = 17) => Array.from({ length: n }, (_, i) => game(i, at(2026, 11, day, 9, i), 'bullet'));
  it('counts from Monday only, and only bullet', () => {
    const games = [...bullets(3), game(50, at(2026, 11, 15, 23), 'bullet'), game(51, at(2026, 11, 17), 'blitz')];
    expect(bulletThisWeek(games, today)).toEqual({ count: 3, limit: 10, state: 'ok' });
  });
  it('turns near at 8 and full at 10', () => {
    expect(bulletThisWeek(bullets(7), today).state).toBe('ok');
    expect(bulletThisWeek(bullets(8), today).state).toBe('near');
    expect(bulletThisWeek(bullets(9), today).state).toBe('near');
    expect(bulletThisWeek(bullets(10), today)).toMatchObject({ count: 10, state: 'full' });
    expect(bulletThisWeek(bullets(12), today).state).toBe('full');
  });
  it('on a Monday only today counts, and later days are ignored', () => {
    const games = [game(1, at(2026, 11, 15), 'bullet'), game(2, at(2026, 11, 16), 'bullet'), game(3, at(2026, 11, 17), 'bullet')];
    expect(bulletThisWeek(games, '2026-11-16').count).toBe(1);
  });
});

describe('blitzSession', () => {
  const day = '2026-11-18';
  const t = (h: number, m: number) => at(2026, 11, 18, h, m);
  it('stops after two losses in a row', () => {
    const s = blitzSession([game(1, t(10, 0), 'blitz', 'loss'), game(2, t(10, 10), 'blitz', 'loss')], [], day);
    expect(s).toEqual({ results: ['loss', 'loss'], losses: 2, stop: true });
  });
  it('loss, win, loss is not a stop', () => {
    const s = blitzSession([game(1, t(10, 0), 'blitz', 'loss'), game(2, t(10, 10), 'blitz', 'win'), game(3, t(10, 20), 'blitz', 'loss')], [], day);
    expect(s).toMatchObject({ losses: 1, stop: false });
  });
  it('a draw ends the streak', () => {
    const s = blitzSession([game(1, t(10, 0), 'blitz', 'loss'), game(2, t(10, 10), 'blitz', 'draw'), game(3, t(10, 20), 'blitz', 'loss')], [], day);
    expect(s.losses).toBe(1);
    expect(blitzSession([game(1, t(10, 0), 'blitz', 'loss'), game(2, t(10, 10), 'blitz', 'loss'), game(3, t(10, 20), 'blitz', 'win')], [], day)).toMatchObject({ losses: 0, stop: false });
  });
  it('ignores yesterday and other speeds', () => {
    const games = [game(1, at(2026, 11, 17, 22), 'blitz', 'loss'), game(2, at(2026, 11, 17, 23), 'blitz', 'loss'), game(3, t(9, 0), 'bullet', 'loss'), game(4, t(9, 5), 'bullet', 'loss')];
    expect(blitzSession(games, [{ at: at(2026, 11, 17, 23, 30), result: 'loss' }], day)).toEqual({ results: [], losses: 0, stop: false });
  });
  it('counts notes made before a sync', () => {
    const notes = [{ at: t(11, 0), result: 'loss' as const }, { at: t(11, 12), result: 'loss' as const }];
    expect(blitzSession([], notes, day)).toMatchObject({ results: ['loss', 'loss'], stop: true });
  });
  it('does not count the same games twice after the sync', () => {
    const notes = [{ at: t(11, 3), result: 'loss' as const }, { at: t(11, 15), result: 'loss' as const }];
    const games = [game(1, t(11, 0), 'blitz', 'loss'), game(2, t(11, 12), 'blitz', 'loss')];
    expect(blitzSession(games, notes, day).results).toEqual(['loss', 'loss']);
  });
  it('matches a game that ended up to 15 minutes before the note or 2 minutes after it', () => {
    const g = [game(1, t(11, 0), 'blitz', 'loss')];
    expect(blitzSession(g, [{ at: t(11, 15), result: 'loss' }], day).results).toEqual(['loss']);
    expect(blitzSession(g, [{ at: t(11, 16), result: 'loss' }], day).results).toEqual(['loss', 'loss']);
    expect(blitzSession(g, [{ at: t(10, 58), result: 'loss' }], day).results).toEqual(['loss']);
    expect(blitzSession(g, [{ at: t(10, 57), result: 'loss' }], day).results).toEqual(['loss', 'loss']);
  });
  it('does not match another result and matches each synced game once', () => {
    const g = [game(1, t(11, 0), 'blitz', 'loss')];
    expect(blitzSession(g, [{ at: t(11, 2), result: 'win' }], day).results).toEqual(['loss', 'win']);
    const two = [{ at: t(11, 1), result: 'loss' as const }, { at: t(11, 2), result: 'loss' as const }];
    expect(blitzSession(g, two, day).results).toEqual(['loss', 'loss']);
  });
  it('a note for a game the sync lacks is kept in time order', () => {
    const games = [game(1, t(10, 0), 'blitz', 'win'), game(3, t(12, 0), 'blitz', 'loss')];
    const s = blitzSession(games, [{ at: t(11, 0), result: 'loss' }], day);
    expect(s.results).toEqual(['win', 'loss', 'loss']);
    expect(s.stop).toBe(true);
  });
});

describe('notes', () => {
  it('sanitizeNotes drops junk and sorts', () => {
    expect(sanitizeNotes([{ at: 5, result: 'loss' }, { at: 2, result: 'win' }, { at: 3, result: 'draw' }, null, { at: 'x', result: 'win' }])).toEqual([
      { at: 2, result: 'win' },
      { at: 5, result: 'loss' },
    ]);
    expect(sanitizeNotes('x')).toEqual([]);
  });
  it('adds and undoes the newest', () => {
    const a = withNote([], 10, 'loss');
    const b = withNote(a, 20, 'win');
    expect(b).toHaveLength(2);
    expect(withoutLastNote(b)).toEqual(a);
    expect(withoutLastNote([])).toEqual([]);
  });
});
