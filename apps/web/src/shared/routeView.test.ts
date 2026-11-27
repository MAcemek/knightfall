import { describe, expect, it } from 'vitest';
import { navIndex, viewKey } from './routeView.ts';

describe('viewKey', () => {
  it('gives each section its own view', () => {
    expect(viewKey('/')).toBe('home');
    expect(viewKey('/puzzles')).toBe('puzzles');
    expect(viewKey('/rush')).not.toBe(viewKey('/battle'));
  });

  it('changes when a section opens a sub-page', () => {
    expect(viewKey('/train/woodpecker')).not.toBe(viewKey('/train'));
    expect(viewKey('/rush/play/3min')).not.toBe(viewKey('/rush'));
    expect(viewKey('/train/woodpecker/abc')).not.toBe(viewKey('/train/woodpecker'));
    expect(viewKey('/train/woodpecker/abc/play')).not.toBe(viewKey('/train/woodpecker/abc'));
    expect(viewKey('/coach/week')).not.toBe(viewKey('/coach/progress'));
    expect(viewKey('/analysis/insights')).not.toBe(viewKey('/analysis'));
  });

  it('stays the same when only a parameter changes', () => {
    expect(viewKey('/daily/2026-11-20')).toBe(viewKey('/daily'));
    expect(viewKey('/daily/2026-11-20')).toBe(viewKey('/daily/2026-11-21'));
    expect(viewKey('/analysis/lichess-abc')).toBe(viewKey('/analysis/chesscom-123'));
    expect(viewKey('/train/vision/find')).toBe(viewKey('/train/vision/name'));
    expect(viewKey('/train/woodpecker/a/play')).toBe(viewKey('/train/woodpecker/b/play'));
    expect(viewKey('/rush/play/3min')).toBe(viewKey('/rush/play/5min'));
  });

  it('ignores a trailing slash', () => {
    expect(viewKey('/train/')).toBe(viewKey('/train'));
  });
});

describe('navIndex', () => {
  const items = [{ to: '/', end: true }, { to: '/puzzles' }, { to: '/train' }, { to: '/analysis' }];

  it('matches the section and its sub-pages', () => {
    expect(navIndex('/', items)).toBe(0);
    expect(navIndex('/puzzles', items)).toBe(1);
    expect(navIndex('/train/woodpecker/abc', items)).toBe(2);
    expect(navIndex('/analysis/insights', items)).toBe(3);
  });

  it('does not match on a shared prefix or for pages outside the nav', () => {
    expect(navIndex('/trainer', items)).toBe(-1);
    expect(navIndex('/coach', items)).toBe(-1);
    expect(navIndex('/settings', items)).toBe(-1);
  });
});
