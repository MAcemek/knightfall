import { coachMoveText } from './coach.ts';
import type { Motif } from './insight.ts';
import type { AnalysedMove, GamePhase, GameReport, MoveClass, Side } from './types.ts';

/**
 * The short written summary under the coach on the review summary: what went well, the turning points, and one
 * thing to practise. Every line is built from the report (classes, accuracy, expected-points loss, insights). Pure.
 */

export interface TurningPoint {
  /** 0-based AnalysedMove.ply. The review page counts moves played, so it opens at ply + 1. */
  ply: number;
  moveNumber: number;
  color: Side;
  san: string;
  cls: MoveClass;
  /** Expected points given away, 0..1. */
  epLoss: number;
  /** One short sentence about what went wrong. */
  reason: string;
}

export type PractiseKind = 'theme' | 'blunder-check' | 'endgames';

export interface PractiseSuggestion {
  kind: PractiseKind;
  /** Train theme id when kind is 'theme'. */
  theme?: string;
  /** Route inside the app. */
  href: string;
  /** Short name of the drill ("Forks", "Blunder check", "Endgames"). */
  label: string;
  /** Why this one, from the game. */
  reason: string;
}

export interface GameSummary {
  /** Up to two facts. */
  wentWell: string[];
  /** Up to 3 of the moves that cost the most (inaccuracies, mistakes, misses and blunders only), in game order. */
  turningPoints: TurningPoint[];
  practise: PractiseSuggestion | null;
}

const BAD: ReadonlySet<MoveClass> = new Set<MoveClass>(['inaccuracy', 'mistake', 'miss', 'blunder']);
/** Accuracy (0..100) a phase needs to be called out. */
const GOOD_PHASE = 85;
/** Moves a phase needs before its accuracy means anything. */
const MIN_PHASE_MOVES = 3;
/** Fewest moves of a side before "no blunders" is worth saying. */
const MIN_MOVES_FOR_CLEAN = 8;
/** Smallest loss (expected points) that is a turning point. */
const MIN_TURNING_LOSS = 0.05;
const MAX_TURNING_POINTS = 3;

/** Mistake motifs that point at a Train drill. Copy of the mapping in the Insights page, kept free of the web app. */
interface MotifPractise {
  /** "left a piece hanging" after "You". */
  past: string;
  drill: { kind: 'theme'; theme: string; label: string } | { kind: 'blunder-check' } | null;
}

/** In tie-break order. A null drill falls back to Endgames (mistakes mostly in the endgame) or the Blunder check. */
export const MOTIF_PRACTISE: Partial<Record<Motif, MotifPractise>> = {
  'hangs-piece': { past: 'left a piece hanging', drill: { kind: 'blunder-check' } },
  'walks-into-fork': { past: 'walked into a fork', drill: { kind: 'theme', theme: 'fork', label: 'Forks' } },
  'misses-mate': { past: 'missed a forced mate', drill: { kind: 'theme', theme: 'mateIn2', label: 'Mate in 2' } },
  'allows-mate': { past: 'allowed a forced mate', drill: { kind: 'theme', theme: 'defensiveMove', label: 'Defensive moves' } },
  'misses-free-piece': { past: 'missed a free piece', drill: { kind: 'blunder-check' } },
  'loses-material': { past: 'lost material to a tactic', drill: { kind: 'blunder-check' } },
  'misses-material': { past: 'missed a chance to win material', drill: { kind: 'blunder-check' } },
  'throws-win': { past: 'threw away a winning position', drill: null },
  'lets-off-hook': { past: 'let the opponent off the hook', drill: null },
  drifts: { past: 'drifted off course', drill: null },
};

const MOTIF_ORDER = Object.keys(MOTIF_PRACTISE) as Motif[];

const sideName = (s: Side) => (s === 'w' ? 'White' : 'Black');
const times = (n: number) => (n === 1 ? 'once' : `${n} times`);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function firstSentence(text: string): string {
  const m = /^.*?[.!?](?=\s|$)/.exec(text);
  return m ? m[0] : text;
}

interface Fact {
  /** Lower is said first. */
  rank: number;
  side: Side;
  text: string;
}

function wentWellFor(moves: AnalysedMove[], side: Side, known: boolean): Fact[] {
  const mine = moves.filter((m) => m.color === side);
  const who = known ? 'You' : sideName(side);
  const poss = known ? 'Your' : `${sideName(side)}'s`;
  const out: Fact[] = [];
  const found = (cls: MoveClass, rank: number, adj: string) => {
    const m = mine.find((x) => x.class === cls);
    if (!m) return;
    const n = mine.filter((x) => x.class === cls).length;
    const extra = n > 1 ? `, one of ${n}` : '';
    out.push({ rank, side, text: `${who} played a ${adj} move on move ${m.moveNumber}: ${m.san}${extra}.` });
  };
  found('brilliant', 0, 'brilliant');
  found('great', 1, 'great');
  const phaseAcc = (phase: GamePhase) => {
    const xs = mine.filter((m) => m.phase === phase).map((m) => m.accuracy);
    return xs.length >= MIN_PHASE_MOVES ? mean(xs) : null;
  };
  const opening = phaseAcc('opening');
  if (opening !== null && opening > GOOD_PHASE) out.push({ rank: 2, side, text: `${poss} opening was accurate: ${Math.round(opening)}% accuracy.` });
  if (mine.length >= MIN_MOVES_FOR_CLEAN && !mine.some((m) => m.class === 'blunder')) {
    out.push({ rank: 3, side, text: `${who} made no blunders.` });
  }
  const middle = phaseAcc('middlegame');
  if (middle !== null && middle > GOOD_PHASE) out.push({ rank: 4, side, text: `${poss} middlegame was accurate: ${Math.round(middle)}% accuracy.` });
  const end = phaseAcc('endgame');
  if (end !== null && end > GOOD_PHASE) out.push({ rank: 5, side, text: `${poss} endgame was accurate: ${Math.round(end)}% accuracy.` });
  return out;
}

function turningPointsFor(moves: AnalysedMove[], sides: readonly Side[], perspective: Side | null): TurningPoint[] {
  return moves
    .filter((m) => sides.includes(m.color) && BAD.has(m.class) && m.epLoss >= MIN_TURNING_LOSS)
    .sort((a, b) => b.epLoss - a.epLoss || a.ply - b.ply)
    .slice(0, MAX_TURNING_POINTS)
    .sort((a, b) => a.ply - b.ply)
    .map((m) => {
      const said = coachMoveText(m, m.insight, perspective);
      const best = m.best && m.best.uci !== m.uci ? m.best.san : null;
      const reason = said
        ? firstSentence(said)
        : best
          ? `The engine preferred ${best}.`
          : `${perspective ? 'Your' : sideName(m.color) + "'s"} win chance fell from ${Math.round(m.winBefore)}% to ${Math.round(m.winAfter)}%.`;
      return { ply: m.ply, moveNumber: m.moveNumber, color: m.color, san: m.san, cls: m.class, epLoss: m.epLoss, reason };
    });
}

function practiseFor(moves: AnalysedMove[], sides: readonly Side[], known: boolean): PractiseSuggestion | null {
  const bad = moves.filter((m) => sides.includes(m.color) && BAD.has(m.class));
  if (!bad.length) return null;
  const counts = new Map<Motif, number>();
  for (const m of bad) {
    const motif = m.insight?.motif;
    if (motif && MOTIF_PRACTISE[motif]) counts.set(motif, (counts.get(motif) ?? 0) + 1);
  }
  let top: Motif | null = null;
  for (const motif of MOTIF_ORDER) {
    const n = counts.get(motif) ?? 0;
    if (n > 0 && (top === null || n > (counts.get(top) ?? 0))) top = motif;
  }
  const meta = top ? MOTIF_PRACTISE[top] : undefined;
  if (top && meta?.drill) {
    const n = counts.get(top) ?? 0;
    const colors = new Set(bad.filter((m) => m.insight?.motif === top).map((m) => m.color));
    const who = known ? 'You' : colors.size > 1 ? 'Both sides' : sideName([...colors][0] ?? 'w');
    const reason = `${who} ${meta.past} ${times(n)} in this game.`;
    if (meta.drill.kind === 'theme') {
      return { kind: 'theme', theme: meta.drill.theme, href: `/train/theme/${meta.drill.theme}`, label: meta.drill.label, reason };
    }
    return { kind: 'blunder-check', href: '/train/blunder-check', label: 'Blunder check', reason };
  }
  const inEndgame = bad.filter((m) => m.phase === 'endgame').length;
  if (inEndgame >= 2 && inEndgame * 2 >= bad.length) {
    return { kind: 'endgames', href: '/train/endgames', label: 'Endgames', reason: `${inEndgame} of the ${bad.length} moves that lost ground came in the endgame.` };
  }
  return {
    kind: 'blunder-check',
    href: '/train/blunder-check',
    label: 'Blunder check',
    reason: `${bad.length} ${bad.length === 1 ? 'move' : 'moves'} lost ground in this game. The Blunder check trains looking for loose pieces and threats before every move.`,
  };
}

/** Summary of the game for `side` (the reader), or for both sides when it is not known which one they played. */
export function gameSummary(report: GameReport, side: Side | null): GameSummary {
  const moves = report.moves;
  const sides: readonly Side[] = side ? [side] : ['w', 'b'];
  const facts = sides
    .flatMap((s) => wentWellFor(moves, s, side !== null))
    .sort((a, b) => a.rank - b.rank || (a.side === b.side ? 0 : a.side === 'w' ? -1 : 1));
  return {
    wentWell: facts.slice(0, 2).map((f) => f.text),
    turningPoints: turningPointsFor(moves, sides, side),
    practise: practiseFor(moves, sides, side !== null),
  };
}
