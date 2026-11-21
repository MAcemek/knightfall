import type { GamePhase, GameReport, MoveClass, Motif } from '@knightfall/core';
import type { StoredGame } from '../../../shared/db.ts';
import { resolveSide, type KnownUsers } from '../../../shared/analysis/side.ts';

export type { KnownUsers };

/** Pure aggregation for the Insights page (no React, no IndexedDB). */

/** Reviews needed before the page shows numbers. */
export const MIN_INSIGHT_GAMES = 3;

export type InsightGameInfo = Pick<StoredGame, 'key' | 'source' | 'white' | 'black' | 'result' | 'playedAt' | 'importedFor' | 'opening'>;

export interface InsightInput {
  game: InsightGameInfo;
  report: GameReport;
}

/* ---------- mistake motifs ---------- */

export const BAD_CLASSES: ReadonlySet<MoveClass> = new Set<MoveClass>(['inaccuracy', 'mistake', 'miss', 'blunder']);

interface MotifMeta {
  /** Start of "<label>: 14 times in 9 games". */
  label: string;
  /** Puzzle theme (shared/themes.ts) that trains this, or null. */
  theme: string | null;
}

/** Mistake motifs shown on the page, in tie-break order. */
export const MOTIF_META: Partial<Record<Motif, MotifMeta>> = {
  'hangs-piece': { label: 'Left a piece hanging', theme: 'hangingPiece' },
  'walks-into-fork': { label: 'Walked into a fork', theme: 'fork' },
  'misses-mate': { label: 'Missed a forced mate', theme: 'mateIn2' },
  'allows-mate': { label: 'Allowed a forced mate', theme: 'defensiveMove' },
  'misses-free-piece': { label: 'Missed a free piece', theme: 'hangingPiece' },
  'loses-material': { label: 'Lost material to a tactic', theme: null },
  'misses-material': { label: 'Missed a chance to win material', theme: null },
  'throws-win': { label: 'Threw away a winning position', theme: null },
  'lets-off-hook': { label: 'Let the opponent off the hook', theme: null },
  drifts: { label: 'Drifted off course', theme: null },
};

const MOTIF_ORDER = Object.keys(MOTIF_META) as Motif[];

export function motifLabel(m: Motif): string {
  return MOTIF_META[m]?.label ?? m;
}

export function motifTheme(m: Motif): string | null {
  return MOTIF_META[m]?.theme ?? null;
}

export interface MotifExample {
  gameKey: string;
  /** 0-based AnalysedMove.ply. */
  ply: number;
  /** Review page path with ?ply= (the review page counts moves played, so ply + 1). */
  href: string;
  moveNumber: number;
  color: 'w' | 'b';
  san: string;
  class: MoveClass;
  opponent: string;
}

export interface MotifRow {
  motif: Motif;
  label: string;
  count: number;
  games: number;
  examples: MotifExample[];
  theme: string | null;
}

export function reviewHref(gameKey: string, ply: number): string {
  return `/analysis/${encodeURIComponent(gameKey)}?ply=${ply + 1}`;
}

/* ---------- aggregation ---------- */

export interface AccuracyPoint {
  gameKey: string;
  at: number;
  accuracy: number;
  side: 'w' | 'b';
}

export interface PhaseRow {
  phase: GamePhase;
  accuracy: number | null;
  /** Games that had moves in this phase. */
  games: number;
}

export interface PerGameRates {
  blunder: number;
  mistake: number;
  miss: number;
  inaccuracy: number;
}

export interface OpeningRow {
  name: string;
  eco: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** (wins + draws / 2) / decided games, 0..1; null when no game had a result. */
  score: number | null;
  accuracy: number | null;
}

export interface InsightsData {
  /** Games that went into the numbers. */
  games: number;
  /** Reviews skipped because we do not know which side is the user's. */
  unknownSide: number;
  /** Reviews skipped because their report is from an older version (still being rebuilt, or it failed). */
  outdated: number;
  accuracySeries: AccuracyPoint[];
  accuracy: { overall: number | null; white: number | null; black: number | null; whiteGames: number; blackGames: number };
  phases: PhaseRow[];
  weakestPhase: GamePhase | null;
  perGame: PerGameRates;
  totals: { blunder: number; mistake: number; miss: number; inaccuracy: number };
  motifs: MotifRow[];
  openings: OpeningRow[];
}

const PHASES: readonly GamePhase[] = ['opening', 'middlegame', 'endgame'];
const MAX_EXAMPLES = 3;
const MIN_OPENING_GAMES = 2;

function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

const r1 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10) / 10);

/** Weakest phase: lowest mean accuracy; needs at least two phases with data to be a comparison. */
export function weakestPhase(rows: readonly PhaseRow[]): GamePhase | null {
  const have = rows.filter((r): r is PhaseRow & { accuracy: number } => r.accuracy !== null);
  if (have.length < 2) return null;
  return have.reduce((a, b) => (b.accuracy < a.accuracy ? b : a)).phase;
}

export function buildInsights(inputs: readonly InsightInput[], users: KnownUsers, currentVersion: number): InsightsData {
  let unknownSide = 0;
  let outdated = 0;
  const used: { game: InsightGameInfo; report: GameReport; side: 'w' | 'b' }[] = [];
  for (const { game, report } of inputs) {
    const side = resolveSide(game, users);
    if (!side) {
      unknownSide++;
      continue;
    }
    if (report.version !== currentVersion) {
      outdated++;
      continue;
    }
    used.push({ game, report, side });
  }
  used.sort((a, b) => a.game.playedAt - b.game.playedAt);

  const accuracySeries: AccuracyPoint[] = [];
  const byColour = { w: [] as number[], b: [] as number[] };
  const phaseVals: Record<GamePhase, number[]> = { opening: [], middlegame: [], endgame: [] };
  const totals = { blunder: 0, mistake: 0, miss: 0, inaccuracy: 0 };
  const motifCounts = new Map<Motif, { count: number; games: Set<string>; all: (MotifExample & { epLoss: number })[] }>();
  const openings = new Map<string, { eco: string | null; wins: number; draws: number; losses: number; acc: number[]; games: number }>();

  for (const { game, report, side } of used) {
    const key = side === 'w' ? 'white' : 'black';
    const acc = report.accuracy[key];
    if (acc !== null) {
      accuracySeries.push({ gameKey: game.key, at: game.playedAt, accuracy: acc, side });
      byColour[side].push(acc);
    }
    for (const ph of PHASES) {
      const v = report.phases[ph][key];
      if (v !== null) phaseVals[ph].push(v);
    }
    const counts = report.counts[key];
    totals.blunder += counts.blunder;
    totals.mistake += counts.mistake;
    totals.miss += counts.miss;
    totals.inaccuracy += counts.inaccuracy;

    const opponent = (side === 'w' ? game.black : game.white).name;
    for (const m of report.moves) {
      if (m.color !== side || !BAD_CLASSES.has(m.class) || !m.insight) continue;
      const motif = m.insight.motif;
      if (!MOTIF_META[motif]) continue;
      const e = motifCounts.get(motif) ?? { count: 0, games: new Set<string>(), all: [] };
      e.count++;
      e.games.add(game.key);
      e.all.push({
        gameKey: game.key, ply: m.ply, href: reviewHref(game.key, m.ply), moveNumber: m.moveNumber, color: m.color, san: m.san, class: m.class, opponent, epLoss: m.epLoss,
      });
      motifCounts.set(motif, e);
    }

    const name = report.opening?.name ?? game.opening?.name;
    if (name) {
      const o = openings.get(name) ?? { eco: report.opening?.eco ?? game.opening?.eco ?? null, wins: 0, draws: 0, losses: 0, acc: [], games: 0 };
      o.games++;
      if (acc !== null) o.acc.push(acc);
      if (game.result === '1/2-1/2') o.draws++;
      else if (game.result === '1-0') {
        if (side === 'w') o.wins++;
        else o.losses++;
      } else if (game.result === '0-1') {
        if (side === 'b') o.wins++;
        else o.losses++;
      }
      openings.set(name, o);
    }
  }

  const n = used.length;
  const phases: PhaseRow[] = PHASES.map((phase) => ({ phase, accuracy: r1(mean(phaseVals[phase])), games: phaseVals[phase].length }));
  const allAcc = accuracySeries.map((p) => p.accuracy);

  const motifs: MotifRow[] = [...motifCounts.entries()]
    .map(([motif, e]) => ({
      motif,
      label: motifLabel(motif),
      count: e.count,
      games: e.games.size,
      examples: [...e.all]
        .sort((a, b) => b.epLoss - a.epLoss || a.gameKey.localeCompare(b.gameKey) || a.ply - b.ply)
        .slice(0, MAX_EXAMPLES)
        .map((ex): MotifExample => ({ gameKey: ex.gameKey, ply: ex.ply, href: ex.href, moveNumber: ex.moveNumber, color: ex.color, san: ex.san, class: ex.class, opponent: ex.opponent })),
      theme: motifTheme(motif),
    }))
    .sort((a, b) => b.count - a.count || MOTIF_ORDER.indexOf(a.motif) - MOTIF_ORDER.indexOf(b.motif));

  const openingRows: OpeningRow[] = [...openings.entries()]
    .filter(([, o]) => o.games >= MIN_OPENING_GAMES)
    .map(([name, o]) => {
      const decided = o.wins + o.draws + o.losses;
      return {
        name, eco: o.eco, games: o.games, wins: o.wins, draws: o.draws, losses: o.losses,
        score: decided ? (o.wins + o.draws / 2) / decided : null,
        accuracy: r1(mean(o.acc)),
      };
    })
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));

  return {
    games: n,
    unknownSide,
    outdated,
    accuracySeries,
    accuracy: {
      overall: r1(mean(allAcc)),
      white: r1(mean(byColour.w)),
      black: r1(mean(byColour.b)),
      whiteGames: byColour.w.length,
      blackGames: byColour.b.length,
    },
    phases,
    weakestPhase: weakestPhase(phases),
    perGame: n
      ? { blunder: totals.blunder / n, mistake: totals.mistake / n, miss: totals.miss / n, inaccuracy: totals.inaccuracy / n }
      : { blunder: 0, mistake: 0, miss: 0, inaccuracy: 0 },
    totals,
    motifs,
    openings: openingRows,
  };
}

/** "14 times in 9 games". */
export function motifSummary(count: number, games: number): string {
  return `${count} ${count === 1 ? 'time' : 'times'} in ${games} ${games === 1 ? 'game' : 'games'}`;
}

/** "Updating 3 of 12 reviews". `done` is how many finished, so the one in progress is done + 1. */
export function updateLine(done: number, total: number): string {
  return `Updating ${Math.min(done + 1, total)} of ${total} ${total === 1 ? 'review' : 'reviews'}`;
}

/** Keys of stored analyses whose report is not of the current version, in the given order. */
export function staleKeys(rows: readonly { gameKey: string; report: { version: number } }[], currentVersion: number): string[] {
  return rows.filter((r) => r.report.version !== currentVersion).map((r) => r.gameKey);
}

/** Axis for the accuracy chart: whole tens around the data, at least 20 tall, kept inside 0..100. */
export function accuracyAxis(values: readonly number[]): { min: number; max: number } {
  if (!values.length) return { min: 0, max: 100 };
  let lo = Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
  let hi = Math.min(100, Math.ceil((Math.max(...values) + 5) / 10) * 10);
  if (hi - lo < 20) {
    lo = Math.max(0, hi - 20);
    hi = lo + 20;
  }
  return { min: lo, max: hi };
}

export interface AccuracyGeometry {
  line: string;
  area: string;
  xy: { x: number; y: number }[];
  min: number;
  max: number;
}

/** SVG path of the accuracy curve (same box model as features/stats chartGeometry, but on a 0..100 scale). */
export function accuracyGeometry(values: readonly number[], w: number, h: number, pad: number): AccuracyGeometry {
  if (!values.length) return { line: '', area: '', xy: [], min: 0, max: 0 };
  const { min, max } = accuracyAxis(values);
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const xy = values.map((v, i) => ({
    x: Math.round((pad + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW)) * 100) / 100,
    y: Math.round((pad + (1 - (v - min) / (max - min)) * innerH) * 100) / 100,
  }));
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  const area = `${line} L${xy[xy.length - 1].x} ${h - pad} L${xy[0].x} ${h - pad} Z`;
  return { line, area, xy, min, max };
}
