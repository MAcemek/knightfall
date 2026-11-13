import { Chess } from 'chess.js';
import type { Puzzle } from '../types.ts';
import { uciToMove, validateLine } from '../validate.ts';
import { classifyMove } from './classify.ts';
import { pieceMaterial } from './sacrifice.ts';
import type { AnalysedMove, GamePhase, GameReport, MoveClass, OpeningTable, PositionEval, Side, SideNumbers } from './types.ts';
import { MOVE_CLASSES } from './types.ts';
import { averageCpLoss, centipawnLoss, estimatedRating, gameAccuracy, moveAccuracy, winPercent, winPercentFor } from './winning.ts';

/** Turns a move list plus one evaluation per position into the report the review page shows. Pure. */

/** EPD = the first four FEN fields (placement, side, castling, en passant). */
export function epdOf(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function sideToMove(fen: string): Side {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Evaluation of a finished position, or null when the game goes on (then the engine must be asked). */
export function terminalEval(fen: string): PositionEval | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  if (chess.isCheckmate()) {
    // The side to move is mated.
    return { fen, depth: 0, source: 'terminal', lines: [], score: { mate: chess.turn() === 'w' ? -1 : 1 }, terminal: 'checkmate' };
  }
  if (chess.isStalemate()) return { fen, depth: 0, source: 'terminal', lines: [], score: { cp: 0 }, terminal: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { fen, depth: 0, source: 'terminal', lines: [], score: { cp: 0 }, terminal: 'draw' };
  return null;
}

/** The opening ends after 8 full moves or with the last book move, whichever is later (at most 15 full moves). */
const OPENING_MIN_PLIES = 16;
const OPENING_MAX_PLIES = 30;
/** The endgame starts when both sides together have at most this much piece material (pawns excluded). */
const ENDGAME_MATERIAL = 13;

function emptyCounts(): Record<MoveClass, number> {
  return Object.fromEntries(MOVE_CLASSES.map((c) => [c, 0])) as Record<MoveClass, number>;
}

function sanOf(fen: string, uci: string): string | null {
  try {
    return new Chess(fen).move(uciToMove(uci)).san;
  } catch {
    return null;
  }
}

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 0;
  }
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export interface ReportInput {
  startFen: string;
  sans: string[];
  ucis: string[];
  /** sans.length + 1 positions (as produced by parsePgnGame). */
  fens: string[];
  /** One evaluation per entry of `fens`, each with `score` White-POV. */
  evals: PositionEval[];
  /** Opening table, or null to skip book detection. */
  openings: OpeningTable | null;
}

/** Build the full report. Throws if the array lengths do not line up. */
export function buildReport(input: ReportInput): GameReport {
  const { startFen, sans, ucis, fens, evals, openings } = input;
  const n = sans.length;
  if (ucis.length !== n || fens.length !== n + 1 || evals.length !== n + 1) throw new Error('buildReport: array lengths do not match');

  // Book: the position AFTER the move is in the table, and every earlier move was book too.
  let bookPlies = 0;
  let opening: GameReport['opening'] = null;
  if (openings) {
    for (let i = 0; i < n && i < OPENING_MAX_PLIES; i++) {
      const hit = openings[epdOf(fens[i + 1])];
      if (!hit) break;
      bookPlies = i + 1;
      opening = { eco: hit[0], name: hit[1], ply: i + 1 };
    }
  }
  const openingEnd = Math.min(OPENING_MAX_PLIES, Math.max(OPENING_MIN_PLIES, bookPlies));
  let endgameStart = n;
  for (let i = 0; i < n; i++) {
    if (pieceMaterial(fens[i]) <= ENDGAME_MATERIAL) {
      endgameStart = i;
      break;
    }
  }

  const firstMover = sideToMove(startFen);
  const startMoveNo = Number(startFen.split(' ')[5]) || 1;
  const moves: AnalysedMove[] = [];
  let previous: MoveClass | undefined;
  for (let i = 0; i < n; i++) {
    const color = sideToMove(fens[i]);
    const before = evals[i];
    const after = evals[i + 1];
    const cls = classifyMove({
      fenBefore: fens[i],
      uci: ucis[i],
      mover: color,
      before,
      after,
      isBook: i < bookPlies,
      legalMoves: legalMoveCount(fens[i]),
      previous,
      previousUci: i > 0 ? ucis[i - 1] : undefined,
    });
    previous = cls;
    const winBefore = winPercentFor(before.score, color);
    const winAfter = winPercentFor(after.score, color);
    const bestUci = before.lines[0]?.pv[0];
    const bestSan = bestUci ? sanOf(fens[i], bestUci) : null;
    const phase: GamePhase = i >= endgameStart ? 'endgame' : i < openingEnd ? 'opening' : 'middlegame';
    moves.push({
      ply: i,
      color,
      moveNumber: startMoveNo + Math.floor((i + (firstMover === 'b' ? 1 : 0)) / 2),
      san: sans[i],
      uci: ucis[i],
      fenBefore: fens[i],
      fenAfter: fens[i + 1],
      class: cls,
      phase,
      winBefore,
      winAfter,
      accuracy: moveAccuracy(winBefore, winAfter),
      cpLoss: centipawnLoss(before.score, after.score, color),
      ...(bestUci && bestSan ? { best: { uci: bestUci, san: bestSan } } : {}),
    });
  }

  const whiteWin = evals.map((e) => winPercent(e.score));
  const of = (side: Side) => moves.filter((m) => m.color === side);
  const perSide = (f: (ms: AnalysedMove[]) => number | null): SideNumbers => ({ white: f(of('w')), black: f(of('b')) });
  const acpl = perSide((ms) => averageCpLoss(ms.map((m) => m.cpLoss)));
  const counts = { white: emptyCounts(), black: emptyCounts() };
  for (const m of moves) counts[m.color === 'w' ? 'white' : 'black'][m.class]++;
  const phaseAcc = (phase: GamePhase): SideNumbers => perSide((ms) => avg(ms.filter((m) => m.phase === phase).map((m) => m.accuracy)));

  const keyMoments = moves
    .map((m) => ({ ply: m.ply, swing: Math.abs(whiteWin[m.ply + 1] - whiteWin[m.ply]) }))
    .filter((x) => x.swing > 10)
    .sort((a, b) => b.swing - a.swing || a.ply - b.ply)
    .slice(0, 3)
    .map((x) => x.ply)
    .sort((a, b) => a - b);

  return {
    version: 1,
    startFen,
    moves,
    evals,
    accuracy: { white: gameAccuracy(whiteWin, 'w', firstMover), black: gameAccuracy(whiteWin, 'b', firstMover) },
    acpl,
    estimatedRating: { white: acpl.white === null ? null : estimatedRating(acpl.white), black: acpl.black === null ? null : estimatedRating(acpl.black) },
    counts,
    phases: { opening: phaseAcc('opening'), middlegame: phaseAcc('middlegame'), endgame: phaseAcc('endgame') },
    keyMoments,
    opening,
  };
}

/* ---------- "Practice your mistakes" ---------- */

/** Classes that become practice puzzles. */
export const PRACTICE_CLASSES: ReadonlySet<MoveClass> = new Set<MoveClass>(['blunder', 'mistake', 'miss']);
/** Longest solution taken from the engine line (solver, reply, solver, reply, solver). */
const PRACTICE_MAX_PLIES = 5;
/** Ids of puzzles made from games start with this (shared/puzzleSource.ts resolves them from customPuzzles). */
export const GAME_PUZZLE_PREFIX = 'game-';

export interface PracticeOptions {
  /** Stable key of the game (StoredGame.key). */
  gameKey: string;
  /** Whose mistakes to turn into puzzles. */
  side: Side;
  /** Puzzle rating to store (the player's game rating when known). */
  rating: number;
  /** e.g. "vs Night-King96". Used in the title. */
  label: string;
}

/**
 * One puzzle per blunder / mistake / miss of `side`: "find the move you should have played".
 * The puzzle starts one ply earlier with the opponent's move as the setup move (Lichess convention,
 * opponentFirst = true) when there is one, then follows the engine's best line for up to 5 plies,
 * always ending on a solver move. Positions without a usable engine line are skipped.
 */
export function mistakePuzzles(report: GameReport, opts: PracticeOptions): Puzzle[] {
  const out: Puzzle[] = [];
  for (const m of report.moves) {
    if (m.color !== opts.side || !PRACTICE_CLASSES.has(m.class)) continue;
    const pv = report.evals[m.ply]?.lines[0]?.pv ?? [];
    if (!pv.length || pv[0] === m.uci) continue;
    let line = pv.slice(0, PRACTICE_MAX_PLIES);
    if (line.length % 2 === 0) line = line.slice(0, -1);
    const setup = m.ply > 0 ? report.moves[m.ply - 1] : null;
    const fen = setup ? setup.fenBefore : m.fenBefore;
    const moves = setup ? [setup.uci, ...line] : line;
    if (validateLine(fen, moves) !== null) continue;
    out.push({
      id: `${GAME_PUZZLE_PREFIX}${opts.gameKey}-${m.ply}`,
      fen,
      moves,
      opponentFirst: !!setup,
      rating: Math.round(opts.rating),
      themes: ['from-game', m.class],
      source: 'custom',
      title: `Your game ${opts.label} · move ${m.moveNumber}`,
    });
  }
  return out;
}
