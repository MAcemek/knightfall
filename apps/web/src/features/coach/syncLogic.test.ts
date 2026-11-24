import { describe, expect, it } from 'vitest';
import { classifyEntry, DRAW_CODES, gameKeyOf, ratingsFromStats, resultOf } from './syncLogic.ts';

const game = (over: Record<string, unknown> = {}) => ({
  url: 'https://www.chess.com/game/live/42',
  time_class: 'blitz',
  rules: 'chess',
  end_time: 1_800_000_000,
  white: { username: 'Dave', result: 'win' },
  black: { username: 'Rival', result: 'resigned' },
  ...over,
});

describe('resultOf', () => {
  it('reads the result from the player side, any letter case', () => {
    expect(resultOf(game(), 'dave')).toBe('win');
    expect(resultOf(game(), 'RIVAL')).toBe('loss');
    expect(resultOf(game(), 'nobody')).toBeNull();
    expect(resultOf(null, 'dave')).toBeNull();
  });
  it('calls the draw codes a draw and everything else a loss', () => {
    for (const code of DRAW_CODES) expect(resultOf(game({ white: { username: 'Dave', result: code } }), 'dave')).toBe('draw');
    for (const code of ['checkmated', 'timeout', 'resigned', 'abandoned', 'lose', 'kingofthehill', '']) {
      expect(resultOf(game({ white: { username: 'Dave', result: code } }), 'dave')).toBe('loss');
    }
    expect(DRAW_CODES).toEqual(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
  });
});

describe('gameKeyOf and classifyEntry', () => {
  const none = new Set<string>();
  it('builds the stored key from the link', () => {
    expect(gameKeyOf(game())).toBe('cc-live-42');
    expect(gameKeyOf(game({ url: 'https://www.chess.com/game/daily/7' }))).toBe('cc-daily-7');
    expect(gameKeyOf(game({ url: 'https://www.chess.com/x' }))).toBeNull();
  });
  it('collects blitz and bullet as activity in ms', () => {
    expect(classifyEntry(game(), 'dave', none)).toEqual({ kind: 'activity', game: { key: 'cc-live-42', at: 1_800_000_000_000, speed: 'blitz', result: 'win' } });
    expect(classifyEntry(game({ time_class: 'bullet' }), 'dave', none)).toMatchObject({ kind: 'activity', game: { speed: 'bullet' } });
  });
  it('imports rapid and Daily only when they are not stored', () => {
    expect(classifyEntry(game({ time_class: 'rapid' }), 'dave', none)).toEqual({ kind: 'import', key: 'cc-live-42' });
    expect(classifyEntry(game({ time_class: 'rapid' }), 'dave', new Set(['cc-live-42']))).toEqual({ kind: 'skip' });
    expect(classifyEntry(game({ time_class: 'daily', url: 'https://www.chess.com/game/daily/9' }), 'dave', none)).toEqual({ kind: 'import', key: 'cc-daily-9' });
  });
  it('skips variants, other time classes and unreadable entries', () => {
    expect(classifyEntry(game({ rules: 'chess960' }), 'dave', none)).toEqual({ kind: 'skip' });
    expect(classifyEntry(game({ rules: undefined }), 'dave', none)).toEqual({ kind: 'skip' });
    expect(classifyEntry(game({ time_class: 'classical' }), 'dave', none)).toEqual({ kind: 'skip' });
    expect(classifyEntry(game({ end_time: undefined }), 'dave', none)).toEqual({ kind: 'skip' });
    expect(classifyEntry(game(), 'someone-else', none)).toEqual({ kind: 'skip' });
    expect(classifyEntry('x', 'dave', none)).toEqual({ kind: 'skip' });
  });
});

describe('ratingsFromStats', () => {
  it('reads last.rating and leaves the rest null', () => {
    expect(ratingsFromStats({ chess_rapid: { last: { rating: 1612.4 } }, chess_blitz: { last: { rating: 50 } }, chess_bullet: 5 })).toEqual({
      rapid: 1612,
      blitz: null,
      bullet: null,
      daily: null,
    });
    expect(ratingsFromStats(null)).toEqual({ rapid: null, blitz: null, bullet: null, daily: null });
  });
});
