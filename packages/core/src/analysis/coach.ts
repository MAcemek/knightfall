import { expectedPoints } from './expectedPoints.ts';
import type { GamePhase, GameReport, MoveClass, Side } from './types.ts';

/** Knightfall's coach lines for Game Review: one summary of the game and one sentence per move. Original wording. */

/** "cxd5 is best", "e4 is a mistake", … */
export const CLASS_PHRASE: Record<MoveClass, string> = {
  brilliant: 'is brilliant',
  great: 'is a great move',
  best: 'is best',
  excellent: 'is excellent',
  good: 'is good',
  book: 'is a book move',
  forced: 'is forced',
  inaccuracy: 'is an inaccuracy',
  mistake: 'is a mistake',
  miss: 'is a miss',
  blunder: 'is a blunder',
};

/** Classes after which the engine's choice is worth showing ("Best was …"). */
export function showsBestMove(cls: MoveClass): boolean {
  return !(cls === 'brilliant' || cls === 'great' || cls === 'best' || cls === 'book' || cls === 'forced');
}

/** An icon grade for a mean accuracy (Advanced Stats). */
export function accuracyGrade(accuracy: number | null): MoveClass | null {
  if (accuracy === null) return null;
  if (accuracy >= 95) return 'best';
  if (accuracy >= 85) return 'excellent';
  if (accuracy >= 70) return 'good';
  if (accuracy >= 55) return 'inaccuracy';
  if (accuracy >= 40) return 'mistake';
  return 'blunder';
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Material balance, White minus Black (pawns included). */
export function materialBalance(fen: string): number {
  let bal = 0;
  for (const ch of fen.split(' ')[0]) {
    const v = VALUE[ch.toLowerCase()];
    if (v) bal += ch === ch.toUpperCase() ? v : -v;
  }
  return bal;
}

const PHASE_WORD: Record<GamePhase, string> = { opening: 'the opening', middlegame: 'the middlegame', endgame: 'the endgame' };

export interface CoachOptions {
  /** The side the reader played, or null to talk about "White" / "Black". */
  perspective: Side | null;
  /** PGN result, e.g. "1-0". */
  result?: string;
}

/** Where the game was decided: the first move after which one side stayed clearly ahead to the end. */
export function decisiveMoment(report: GameReport): { ply: number; winner: Side; material: number } | null {
  const ep = report.evals.map((e) => expectedPoints(e.score));
  const n = report.moves.length;
  if (!n) return null;
  const final = ep[n];
  const winner: Side | null = final >= 0.8 ? 'w' : final <= 0.2 ? 'b' : null;
  if (!winner) return null;
  let start = n;
  while (start > 0 && (winner === 'w' ? ep[start - 1] >= 0.8 : ep[start - 1] <= 0.2)) start--;
  // ep[start] is the first position of the final winning stretch; the move that led there is start - 1.
  const ply = Math.max(0, start - 1);
  const m = report.moves[ply];
  const later = report.moves[Math.min(n - 1, ply + 2)];
  const sign = winner === 'w' ? 1 : -1;
  const material = sign * (materialBalance(later.fenAfter) - materialBalance(m.fenBefore));
  return { ply, winner, material };
}

/** One sentence summing up the game. */
export function coachSummary(report: GameReport, opts: CoachOptions): string {
  const you = opts.perspective;
  const name = (s: Side) => (s === 'w' ? 'White' : 'Black');
  const decisive = decisiveMoment(report);
  const acc = you ? report.accuracy[you === 'w' ? 'white' : 'black'] : null;

  if (decisive) {
    const phase = PHASE_WORD[report.moves[decisive.ply].phase];
    const won = you === decisive.winner;
    const lost = you !== null && !won;
    const subject = you === null ? name(decisive.winner) : 'You';
    if (lost) {
      const slip = report.moves[decisive.ply];
      return slip.class === 'blunder' || slip.class === 'mistake'
        ? `One slip in ${phase} decided this game. Let's find where it turned.`
        : `Your opponent took over in ${phase}. Let's see how they did it.`;
    }
    if (decisive.material >= 3) return `${subject} won a piece in ${phase} and never let go!`;
    if (decisive.material >= 1) return `${subject} picked up material in ${phase} and kept control to the end.`;
    return `${subject} took charge in ${phase} and never looked back.`;
  }
  if (opts.result === '1/2-1/2') return 'A hard-fought draw. Both sides held their ground.';
  if (acc !== null && acc >= 90) return 'Sharp, accurate play from start to finish!';
  return 'A game with chances for both sides. Let\'s look at the key moments.';
}

/** "cxd5 is best" for a played move. */
export function moveSentence(san: string, cls: MoveClass): string {
  return `${san} ${CLASS_PHRASE[cls]}`;
}
