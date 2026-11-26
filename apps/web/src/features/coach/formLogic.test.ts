import { describe, expect, it } from 'vitest';
import { baselineSummary, blankForm, formFromPlan, planFromForm, targetSummary, withBaseline, withFetched, withTarget } from './formLogic.ts';
import { emptyBaselines, emptyTargets } from './planLogic.ts';

describe('suggested targets', () => {
  it('follow the starting ratings until one target is edited', () => {
    let f = blankForm('', '2026-03-02');
    expect(f.targets.rapid.three).toBe('');
    f = withBaseline(f, 'rapid', '1200');
    expect(f.targets.rapid).toEqual({ three: '1270', six: '1325' });
    f = withBaseline(f, 'rapid', '1300');
    expect(f.targets.rapid.three).toBe('1370');
    f = withTarget(f, 'rapid', 'three', '1500');
    f = withBaseline(f, 'rapid', '1400');
    expect(f.targets.rapid.three).toBe('1500');
    expect(f.targets.rapid.six).toBe('1425');
  });
  it('are kept as stored when a plan is opened', () => {
    const b = emptyBaselines();
    b.rapid = 1200;
    const t = emptyTargets();
    t.rapid = { three: 1222, six: null };
    const f = withBaseline(formFromPlan({ username: 'abc', startDate: '2026-03-02', baselines: b, targets: t }), 'rapid', '1250');
    expect(f.targets.rapid.three).toBe('1222');
  });
  it('only fill empty boxes when ratings are fetched', () => {
    let f = withBaseline(blankForm('', '2026-03-02'), 'rapid', '1100');
    f = withFetched(f, { rapid: 1500, blitz: 1400, bullet: null, daily: null });
    expect(f.baselines.rapid).toBe('1100');
    expect(f.baselines.blitz).toBe('1400');
    expect(f.baselines.bullet).toBe('');
  });
});

describe('planFromForm', () => {
  it('builds a plan, empty boxes become null', () => {
    let f = blankForm('Some_User', '2026-03-02');
    f = withBaseline(f, 'rapid', '1200');
    const r = planFromForm(f);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.username).toBe('Some_User');
      expect(r.plan.baselines.rapid).toBe(1200);
      expect(r.plan.baselines.blitz).toBeNull();
      expect(r.plan.targets.rapid.six).toBe(1325);
    }
  });
  it('allows no username', () => {
    const r = planFromForm(blankForm('  ', '2026-03-02'));
    expect(r.ok && r.plan.username).toBe('');
  });
  it('refuses a bad rating, username or date', () => {
    expect(planFromForm(withBaseline(blankForm('', '2026-03-02'), 'blitz', '12')).ok).toBe(false);
    expect(planFromForm(withBaseline(blankForm('', '2026-03-02'), 'blitz', 'abc')).ok).toBe(false);
    expect(planFromForm(withTarget(blankForm('', '2026-03-02'), 'rapid', 'six', '99999')).ok).toBe(false);
    expect(planFromForm(blankForm('bad name!', '2026-03-02')).ok).toBe(false);
    expect(planFromForm(blankForm('', '')).ok).toBe(false);
  });
});

describe('summaries of the collapsed parts', () => {
  it('words the ratings', () => {
    expect(baselineSummary(blankForm('', '2026-03-02'))).toContain('No ratings yet');
    let f = withBaseline(blankForm('', '2026-03-02'), 'rapid', '1200');
    f = withBaseline(f, 'blitz', 'abc');
    f = withBaseline(f, 'bullet', '1100');
    expect(baselineSummary(f)).toBe('Rapid 1200, Bullet 1100');
  });
  it('words the targets, including one-sided and empty ones', () => {
    expect(targetSummary(blankForm('', '2026-03-02'))).toContain('No targets yet');
    let f = withBaseline(blankForm('', '2026-03-02'), 'rapid', '1200');
    f = withBaseline(f, 'bullet', '1100');
    expect(targetSummary(f)).toBe('Targets after 3 and 6 months: Rapid 1270 and 1325, Bullet 1100 (3 months)');
    f = withTarget(f, 'rapid', 'three', '');
    expect(targetSummary(f)).toContain('Rapid 1325 (6 months)');
  });
});
