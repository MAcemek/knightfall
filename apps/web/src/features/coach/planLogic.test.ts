import { describe, expect, it } from 'vitest';
import { cleanRating, parseRatingInput, PHASES, sanitizePlan, suggestTargets, weekInfo } from './planLogic.ts';

const none = { rapid: null, blitz: null, bullet: null, daily: null };

describe('sanitizePlan', () => {
  const good = {
    username: 'Sample_User',
    startDate: '2026-11-02',
    baselines: { rapid: 1600, blitz: 1500, bullet: 1400, daily: 1200 },
    targets: { rapid: { three: 1670, six: 1725 }, blitz: { three: null, six: null }, bullet: { three: 1400, six: null }, daily: { three: 1400, six: 1540 } },
  };
  it('keeps a good plan and the name as typed', () => {
    expect(sanitizePlan(good)).toEqual(good);
  });
  it('needs a real start date', () => {
    expect(sanitizePlan(null)).toBeNull();
    expect(sanitizePlan('x')).toBeNull();
    expect(sanitizePlan([])).toBeNull();
    expect(sanitizePlan({ ...good, startDate: '2026-02-31' })).toBeNull();
    expect(sanitizePlan({ ...good, startDate: undefined })).toBeNull();
  });
  it('turns damaged parts into nulls and an empty name', () => {
    const p = sanitizePlan({
      username: 'bad name!',
      startDate: '2026-11-02',
      baselines: { rapid: 50, blitz: 4001, bullet: 1500.5, daily: '1400' },
      targets: { rapid: { three: 'x', six: 1800 }, blitz: 7 },
    });
    expect(p?.username).toBe('');
    expect(p?.baselines).toEqual(none);
    expect(p?.targets.rapid).toEqual({ three: null, six: 1800 });
    expect(p?.targets.blitz).toEqual({ three: null, six: null });
    expect(p?.targets.daily).toEqual({ three: null, six: null });
  });
  it('accepts an empty username', () => {
    expect(sanitizePlan({ ...good, username: '' })?.username).toBe('');
    expect(sanitizePlan({ ...good, username: 5 })?.username).toBe('');
  });
});

describe('ratings', () => {
  it('cleanRating keeps whole ratings from 100 to 4000', () => {
    expect([cleanRating(100), cleanRating(4000), cleanRating(99), cleanRating(1500.5), cleanRating('1500'), cleanRating(null)]).toEqual([100, 4000, null, null, null, null]);
  });
  it('parseRatingInput reads typed numbers', () => {
    expect([parseRatingInput(' 1450 '), parseRatingInput(''), parseRatingInput('14a'), parseRatingInput('99'), parseRatingInput('5000')]).toEqual([1450, null, null, null, null]);
  });
});

describe('suggestTargets', () => {
  it('climbs rapid and blitz, holds bullet', () => {
    const t = suggestTargets({ rapid: 1500, blitz: 1400, bullet: 1300, daily: null });
    expect(t.rapid).toEqual({ three: 1570, six: 1625 });
    expect(t.blitz).toEqual({ three: 1475, six: 1535 });
    expect(t.bullet).toEqual({ three: 1300, six: null });
    expect(t.daily).toEqual({ three: null, six: null });
  });
  it('gives nothing for an unknown baseline', () => {
    const t = suggestTargets(none);
    for (const s of ['rapid', 'blitz', 'bullet', 'daily'] as const) expect(t[s]).toEqual({ three: null, six: null });
  });
  it('pulls Daily toward rapid when it lags by 200 or more', () => {
    expect(suggestTargets({ rapid: 1600, blitz: null, bullet: null, daily: 1200 }).daily).toEqual({ three: 1400, six: 1540 });
    // gap 409: 1404.5 rounds up to 1405 and 1547.65 to 1548
    expect(suggestTargets({ rapid: 1609, blitz: null, bullet: null, daily: 1200 }).daily).toEqual({ three: 1405, six: 1548 });
  });
  it('uses the plain climb for Daily when the gap is under 200 or rapid is unknown', () => {
    expect(suggestTargets({ rapid: 1399, blitz: null, bullet: null, daily: 1200 }).daily).toEqual({ three: 1250, six: 1300 });
    expect(suggestTargets({ rapid: null, blitz: null, bullet: null, daily: 1200 }).daily).toEqual({ three: 1250, six: 1300 });
    expect(suggestTargets({ rapid: 1400, blitz: null, bullet: null, daily: 1200 }).daily.three).toBe(1300);
  });
});

describe('weekInfo', () => {
  it('is before the start', () => {
    expect(weekInfo('2026-11-02', '2026-11-01')).toMatchObject({ state: 'before', day: 0, offset: -1 });
  });
  it('counts days, weeks and phases', () => {
    expect(weekInfo('2026-11-02', '2026-11-02')).toMatchObject({ state: 'running', day: 1, week: 1, phase: 1 });
    expect(weekInfo('2026-11-02', '2026-11-08')).toMatchObject({ day: 7, week: 1 });
    expect(weekInfo('2026-11-02', '2026-11-09')).toMatchObject({ day: 8, week: 2 });
    expect(weekInfo('2026-11-02', '2026-11-29')).toMatchObject({ day: 28, week: 4, phase: 1 });
    expect(weekInfo('2026-11-02', '2026-11-30')).toMatchObject({ day: 29, week: 5, phase: 2 });
    expect(weekInfo('2026-11-02', '2026-12-27')).toMatchObject({ day: 56, week: 8, phase: 2 });
    expect(weekInfo('2026-11-02', '2026-12-28')).toMatchObject({ day: 57, week: 9, phase: 3 });
  });
  it('ends after 84 days', () => {
    expect(weekInfo('2026-11-02', '2027-01-24')).toMatchObject({ state: 'running', day: 84, week: 12, phase: 3 });
    expect(weekInfo('2026-11-02', '2027-01-25')).toMatchObject({ state: 'after', day: 84, week: 12, phase: 3 });
  });
  it('has a text for every phase', () => {
    expect(PHASES[1]).toMatch(/^Woodpecker cycle 1/);
    expect(PHASES[2]).toMatch(/^Woodpecker cycles 2 and 3/);
    expect(PHASES[3]).toMatch(/teach one lesson at your club\.$/);
  });
});
