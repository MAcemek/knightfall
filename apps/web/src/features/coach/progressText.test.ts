import { describe, expect, it } from 'vitest';
import { blunderTile, clockTile, ratingTile, secondsText } from './progressText.ts';

describe('ratingTile', () => {
  it('says what is missing', () => {
    expect(ratingTile([], null).value).toBe('None yet');
    expect(ratingTile([{ date: '2026-03-02', rating: 1200 }], null).sub).toContain('Plan settings');
  });
  it('compares with the line', () => {
    const s = [{ date: '2026-03-02', rating: 1250 }];
    expect(ratingTile(s, { date: '2026-03-02', rating: 1250, target: 1230, delta: 20 })).toEqual({ value: '1250', sub: '20 above the line (1230)' });
    expect(ratingTile(s, { date: '2026-03-02', rating: 1250, target: 1250, delta: 0 }).sub).toContain('On the line');
    expect(ratingTile(s, { date: '2026-03-02', rating: 1250, target: 1260.4, delta: -10.4 }).sub).toContain('10 below');
  });
});

describe('blunderTile', () => {
  it('handles no games, too few earlier games and a goal', () => {
    expect(blunderTile({ last: null, previous: null, goal: null, games: { last: 0, previous: 0 } }).value).toBe('None yet');
    expect(blunderTile({ last: 2.35, previous: null, goal: null, games: { last: 4, previous: 1 } }).sub).toContain('goal');
    const t = blunderTile({ last: 1.5, previous: 2.35, goal: 1.175, games: { last: 10, previous: 10 } });
    expect(t.value).toBe('1.5');
    expect(t.sub).toContain('Goal: 1.2');
  });
});

describe('clockTile', () => {
  it('shows the share and the goal', () => {
    expect(clockTile({ share: null, games: 0, state: null }).value).toBe('None yet');
    expect(clockTile({ share: 0.55, games: 5, state: 'low' }).sub).toContain('Low');
    expect(clockTile({ share: 0.65, games: 5, state: 'good' })).toEqual({ value: '65%', sub: 'Goal: use 60 to 70% of your time.' });
  });
});

describe('secondsText', () => {
  it('words a time', () => {
    expect(secondsText(42_000)).toBe('42 s');
    expect(secondsText(65_000)).toBe('1 min 5 s');
    expect(secondsText(null)).toBe('none');
  });
});
