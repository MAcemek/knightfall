import { describe, expect, it } from 'vitest';
import type { OpeningLineProgress } from '../../shared/db.ts';
import { REVIEW_INTERVALS_MS, REVIEW_MAX_BOX } from '../../shared/progress/srs.ts';
import {
  familyStats, gradeLine, isChosen, isDrillable, isUserPly, judgeBookMove, nextUserPly, parseOpeningData, pickNextLine,
  progressId, progressMap, sanitizeChosen, searchFamilies, toggleChosen, userMoveCount,
  type OpeningFamily, type OpeningLine,
} from './openingLogic.ts';

const NOW = 1_000_000_000;
const line = (id: string, uci: string[]): OpeningLine => ({ id, name: `Name ${id}`, eco: 'C50', uci });
const row = (l: OpeningLine, color: 'w' | 'b', box: number, due: number, misses = 0): OpeningLineProgress => ({
  id: progressId(l.id, color), family: 'F', color, box, due, lastAt: null, misses,
});

const italian = line('a', ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5']);
const short = line('b', ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
const odd = line('c', ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4']);

describe('sides and drillability', () => {
  it('knows whose ply it is', () => {
    expect(isUserPly(0, 'w')).toBe(true);
    expect(isUserPly(1, 'w')).toBe(false);
    expect(isUserPly(0, 'b')).toBe(false);
    expect(isUserPly(1, 'b')).toBe(true);
  });
  it('counts the moves of one side', () => {
    expect(userMoveCount(italian, 'w')).toBe(3);
    expect(userMoveCount(italian, 'b')).toBe(3);
    expect(userMoveCount(odd, 'w')).toBe(3);
    expect(userMoveCount(odd, 'b')).toBe(2);
  });
  it('needs at least two moves for the side to be drillable', () => {
    expect(isDrillable(short, 'w')).toBe(true);
    expect(isDrillable(line('x', ['e2e4', 'e7e5', 'g1f3']), 'b')).toBe(false);
    expect(isDrillable(line('y', ['e2e4', 'e7e5', 'g1f3']), 'w')).toBe(true);
  });
  it('finds the next ply the user has to play', () => {
    expect(nextUserPly(italian, 0, 'w')).toBe(0);
    expect(nextUserPly(italian, 1, 'w')).toBe(2);
    expect(nextUserPly(italian, 0, 'b')).toBe(1);
    expect(nextUserPly(italian, 6, 'w')).toBeNull();
    expect(nextUserPly(italian, 6, 'b')).toBeNull();
  });
  it('judges a move against the book', () => {
    expect(judgeBookMove(italian, 2, 'g1f3')).toBe(true);
    expect(judgeBookMove(italian, 2, 'b1c3')).toBe(false);
    expect(judgeBookMove(italian, 9, 'g1f3')).toBe(false);
  });
});

describe('grading', () => {
  const meta = { id: progressId('a', 'w'), family: 'F', color: 'w' as const };
  it('files a first sight in box 0 due in 10 minutes', () => {
    const p = gradeLine(null, meta, true, NOW);
    expect(p).toMatchObject({ box: 0, due: NOW + REVIEW_INTERVALS_MS[0], lastAt: NOW, misses: 0 });
    expect(gradeLine(null, meta, false, NOW).misses).toBe(1);
  });
  it('moves up a box on a clean run', () => {
    const p = gradeLine(row(italian, 'w', 1, NOW), meta, true, NOW);
    expect(p.box).toBe(2);
    expect(p.due).toBe(NOW + REVIEW_INTERVALS_MS[2]);
  });
  it('stays in the top box', () => {
    const p = gradeLine(row(italian, 'w', REVIEW_MAX_BOX, NOW), meta, true, NOW);
    expect(p.box).toBe(REVIEW_MAX_BOX);
    expect(p.due).toBe(NOW + REVIEW_INTERVALS_MS[REVIEW_MAX_BOX]);
  });
  it('sends a missed line back to box 0 and counts the miss', () => {
    const p = gradeLine(row(italian, 'w', 3, NOW, 2), meta, false, NOW);
    expect(p).toMatchObject({ box: 0, due: NOW + REVIEW_INTERVALS_MS[0], misses: 3 });
  });
});

describe('picking the next line', () => {
  const lines = [italian, short, odd];
  it('takes the most overdue line first', () => {
    const rows = [row(italian, 'w', 1, NOW - 10), row(short, 'w', 1, NOW - 500), row(odd, 'w', 1, NOW + 5000)];
    const pick = pickNextLine(lines, progressMap(rows), 'w', NOW);
    expect(pick?.line.id).toBe('b');
    expect(pick?.kind).toBe('due');
    expect(pick?.progress?.id).toBe(progressId('b', 'w'));
  });
  it('then the never-seen lines in catalogue order', () => {
    const pick = pickNextLine(lines, progressMap([row(italian, 'w', 1, NOW + 5000)]), 'w', NOW);
    expect(pick?.line.id).toBe('b');
    expect(pick?.kind).toBe('new');
    expect(pick?.progress).toBeNull();
  });
  it('treats the other colour as unseen', () => {
    const pick = pickNextLine(lines, progressMap([row(italian, 'b', 1, NOW + 5000)]), 'w', NOW);
    expect(pick?.line.id).toBe('a');
    expect(pick?.kind).toBe('new');
  });
  it('skips lines that are not drillable for the colour', () => {
    const tiny = line('t', ['e2e4', 'e7e5', 'g1f3']);
    const pick = pickNextLine([tiny, short], progressMap([]), 'b', NOW);
    expect(pick?.line.id).toBe('b');
  });
  it('skips excluded ids and returns null when nothing is left', () => {
    const rows = [row(italian, 'w', 1, NOW + 1), row(short, 'w', 1, NOW + 1), row(odd, 'w', 1, NOW + 1)];
    expect(pickNextLine(lines, progressMap(rows), 'w', NOW)).toBeNull();
    expect(pickNextLine(lines, progressMap([]), 'w', NOW, new Set([progressId('a', 'w')]))?.line.id).toBe('b');
  });
});

describe('family stats', () => {
  const fam: OpeningFamily = { name: 'F', eco: 'C50', lines: [italian, short, odd] };
  it('counts due, new and total for a colour', () => {
    const rows = [row(italian, 'w', 1, NOW - 1), row(short, 'w', 2, NOW + 100)];
    expect(familyStats(fam, 'w', progressMap(rows), NOW)).toEqual({ total: 3, due: 1, fresh: 1, learned: 2 });
    expect(familyStats(fam, 'b', progressMap(rows), NOW)).toEqual({ total: 3, due: 0, fresh: 3, learned: 0 });
  });
  it('only counts lines drillable for the colour', () => {
    const tiny = line('z', ['e2e4', 'e7e5', 'g1f3']);
    expect(familyStats({ ...fam, lines: [tiny] }, 'b', progressMap([]), NOW).total).toBe(0);
  });
});

describe('families and the chosen list', () => {
  const fams: OpeningFamily[] = [
    { name: 'Italian Game', eco: 'C50', lines: [italian] },
    { name: 'Sicilian Defense', eco: 'B20', lines: [odd] },
    { name: 'Tiny', eco: 'A00', lines: [line('q', ['e2e4', 'e7e5', 'g1f3'])] },
  ];
  it('searches by name and hides families with nothing to drill', () => {
    expect(searchFamilies(fams, '', 'w').map((f) => f.name)).toEqual(['Italian Game', 'Sicilian Defense', 'Tiny']);
    expect(searchFamilies(fams, '', 'b').map((f) => f.name)).toEqual(['Italian Game', 'Sicilian Defense']);
    expect(searchFamilies(fams, '  ITAL ', 'w').map((f) => f.name)).toEqual(['Italian Game']);
    expect(searchFamilies(fams, 'c50', 'w').map((f) => f.name)).toEqual(['Italian Game']);
  });
  it('toggles a family per colour', () => {
    let chosen = toggleChosen([], 'Italian Game', 'w');
    expect(isChosen(chosen, 'Italian Game', 'w')).toBe(true);
    expect(isChosen(chosen, 'Italian Game', 'b')).toBe(false);
    chosen = toggleChosen(chosen, 'Italian Game', 'b');
    expect(chosen).toHaveLength(2);
    chosen = toggleChosen(chosen, 'Italian Game', 'w');
    expect(chosen).toEqual([{ name: 'Italian Game', color: 'b' }]);
  });
  it('sanitizes what comes back from storage', () => {
    expect(sanitizeChosen(null)).toEqual([]);
    expect(sanitizeChosen('x')).toEqual([]);
    expect(
      sanitizeChosen([{ name: 'A', color: 'w' }, { name: 'A', color: 'w' }, { name: 3, color: 'w' }, { name: 'B', color: 'x' }, null, { name: 'C', color: 'b' }]),
    ).toEqual([{ name: 'A', color: 'w' }, { name: 'C', color: 'b' }]);
  });
});

describe('parseOpeningData', () => {
  it('accepts the generated shape', () => {
    const raw = { families: [{ name: 'F', eco: 'C50', lines: [{ id: 'a', name: 'N', eco: 'C50', uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'] }] }] };
    expect(parseOpeningData(raw)?.families[0].lines[0].id).toBe('a');
  });
  it('rejects anything else and drops broken entries', () => {
    expect(parseOpeningData(null)).toBeNull();
    expect(parseOpeningData({})).toBeNull();
    const raw = { families: [{ name: 'F', eco: 'C50', lines: [{ id: 'a', name: 'N', eco: 'C50', uci: [1] }, { id: 'b', name: 'N', eco: 'C50', uci: ['e2e4'] }] }, { name: 1 }] };
    const parsed = parseOpeningData(raw);
    expect(parsed?.families).toHaveLength(1);
    expect(parsed?.families[0].lines.map((l) => l.id)).toEqual(['b']);
  });
});
