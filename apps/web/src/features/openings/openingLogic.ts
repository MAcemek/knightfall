import type { OpeningLineProgress } from '../../shared/db.ts';
import { REVIEW_INTERVALS_MS, REVIEW_MAX_BOX } from '../../shared/progress/srs.ts';

/** Pure rules for the opening trainer: what is drillable, what comes next, how a run is graded. */

export type Side = 'w' | 'b';

export interface OpeningLine {
  id: string;
  name: string;
  eco: string;
  uci: string[];
}

export interface OpeningFamily {
  name: string;
  eco: string;
  lines: OpeningLine[];
}

export interface OpeningData {
  families: OpeningFamily[];
}

/** A family the player chose to practise, as one colour. */
export interface ChosenFamily {
  name: string;
  color: Side;
}

/** KV key holding the chosen families (ChosenFamily[]). */
export const OPENING_FAMILIES_KEY = 'openingFamilies';

/** A line needs at least this many moves for the drilled side to be worth drilling. */
export const MIN_USER_MOVES = 2;

export function isUserPly(ply: number, color: Side): boolean {
  return (ply % 2 === 0) === (color === 'w');
}

export function userMoveCount(line: OpeningLine, color: Side): number {
  let n = 0;
  for (let ply = 0; ply < line.uci.length; ply++) if (isUserPly(ply, color)) n++;
  return n;
}

export function isDrillable(line: OpeningLine, color: Side): boolean {
  return userMoveCount(line, color) >= MIN_USER_MOVES;
}

/** The first ply at or after `from` that the user has to play, or null when the line is over. */
export function nextUserPly(line: OpeningLine, from: number, color: Side): number | null {
  for (let ply = from; ply < line.uci.length; ply++) if (isUserPly(ply, color)) return ply;
  return null;
}

export function judgeBookMove(line: OpeningLine, ply: number, uci: string): boolean {
  return line.uci[ply] === uci;
}

/** Progress rows are keyed by line and colour, so one line can be learned as both White and Black. */
export function progressId(lineId: string, color: Side): string {
  return `${lineId}:${color}`;
}

export function progressMap(rows: readonly OpeningLineProgress[]): Map<string, OpeningLineProgress> {
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Grade one run of a line. A first sight files the line in box 0. A clean run moves it up a box (the top box
 * stays); any mistake sends it back to box 0 so it returns in 10 minutes.
 */
export function gradeLine(
  prev: OpeningLineProgress | null,
  meta: { id: string; family: string; color: Side },
  clean: boolean,
  now: number,
): OpeningLineProgress {
  const misses = (prev?.misses ?? 0) + (clean ? 0 : 1);
  const box = prev === null || !clean ? 0 : Math.min(prev.box + 1, REVIEW_MAX_BOX);
  return { id: meta.id, family: meta.family, color: meta.color, box, due: now + REVIEW_INTERVALS_MS[box], lastAt: now, misses };
}

export interface NextLine {
  line: OpeningLine;
  /** Null for a line that was never seen. */
  progress: OpeningLineProgress | null;
  kind: 'due' | 'new';
}

/**
 * The next line to drill: the most overdue one, then never-seen lines in catalogue order. `lines` is in
 * catalogue order. Ids in `skip` are progress ids to leave out (already done this session).
 */
export function pickNextLine(
  lines: readonly OpeningLine[],
  progress: ReadonlyMap<string, OpeningLineProgress>,
  color: Side,
  now: number,
  skip: ReadonlySet<string> = new Set(),
): NextLine | null {
  let overdue: NextLine | null = null;
  let fresh: NextLine | null = null;
  for (const line of lines) {
    if (!isDrillable(line, color)) continue;
    const id = progressId(line.id, color);
    if (skip.has(id)) continue;
    const p = progress.get(id) ?? null;
    if (p === null) {
      fresh ??= { line, progress: null, kind: 'new' };
    } else if (p.due <= now && (overdue === null || p.due < (overdue.progress?.due ?? Infinity))) {
      overdue = { line, progress: p, kind: 'due' };
    }
  }
  return overdue ?? fresh;
}

export interface FamilyStats {
  /** Lines that are drillable for the colour. */
  total: number;
  due: number;
  /** Never seen. */
  fresh: number;
  /** Seen at least once. */
  learned: number;
}

export function familyStats(family: OpeningFamily, color: Side, progress: ReadonlyMap<string, OpeningLineProgress>, now: number): FamilyStats {
  const s: FamilyStats = { total: 0, due: 0, fresh: 0, learned: 0 };
  for (const line of family.lines) {
    if (!isDrillable(line, color)) continue;
    s.total++;
    const p = progress.get(progressId(line.id, color));
    if (!p) s.fresh++;
    else {
      s.learned++;
      if (p.due <= now) s.due++;
    }
  }
  return s;
}

/** Families that match the search (name or ECO code) and have something to drill for the colour. */
export function searchFamilies(families: readonly OpeningFamily[], query: string, color: Side): OpeningFamily[] {
  const q = query.trim().toLowerCase();
  return families.filter(
    (f) => f.lines.some((l) => isDrillable(l, color)) && (q === '' || f.name.toLowerCase().includes(q) || f.eco.toLowerCase() === q),
  );
}

export function isChosen(chosen: readonly ChosenFamily[], name: string, color: Side): boolean {
  return chosen.some((c) => c.name === name && c.color === color);
}

export function toggleChosen(chosen: readonly ChosenFamily[], name: string, color: Side): ChosenFamily[] {
  return isChosen(chosen, name, color) ? chosen.filter((c) => !(c.name === name && c.color === color)) : [...chosen, { name, color }];
}

/** Whatever came back from storage, as a clean list without duplicates. */
export function sanitizeChosen(raw: unknown): ChosenFamily[] {
  if (!Array.isArray(raw)) return [];
  const out: ChosenFamily[] = [];
  for (const c of raw as unknown[]) {
    if (typeof c !== 'object' || c === null) continue;
    const { name, color } = c as { name?: unknown; color?: unknown };
    if (typeof name !== 'string' || (color !== 'w' && color !== 'b') || isChosen(out, name, color)) continue;
    out.push({ name, color });
  }
  return out;
}

/** Validates the fetched opening-lines.json. Broken lines and families are dropped; null when unusable. */
export function parseOpeningData(raw: unknown): OpeningData | null {
  const fams = (raw as { families?: unknown } | null)?.families;
  if (!Array.isArray(fams)) return null;
  const families: OpeningFamily[] = [];
  for (const f of fams as unknown[]) {
    const fam = f as { name?: unknown; eco?: unknown; lines?: unknown } | null;
    if (typeof fam?.name !== 'string' || typeof fam.eco !== 'string' || !Array.isArray(fam.lines)) continue;
    const lines: OpeningLine[] = [];
    for (const l of fam.lines as unknown[]) {
      const line = l as { id?: unknown; name?: unknown; eco?: unknown; uci?: unknown } | null;
      if (typeof line?.id !== 'string' || typeof line.name !== 'string' || typeof line.eco !== 'string') continue;
      if (!Array.isArray(line.uci) || !line.uci.every((m) => typeof m === 'string')) continue;
      lines.push({ id: line.id, name: line.name, eco: line.eco, uci: line.uci as string[] });
    }
    if (lines.length) families.push({ name: fam.name, eco: fam.eco, lines });
  }
  return families.length ? { families } : null;
}
