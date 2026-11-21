import type { PieceSymbol } from 'chess.js';
import { LOSS_EXCELLENT } from './classify.ts';
import { expectedPoints, expectedPointsLoss } from './expectedPoints.ts';
import type { BestReason, MoveInsight } from './insight.ts';
import { PIECE_VALUE } from './pieceSafety.ts';
import type { AnalysedMove, GamePhase, GameReport, MoveClass, PositionEval, Side } from './types.ts';

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

/* ---------- Per-move tips: Explain, Best and the coach bubble ---------- */

const PIECE_NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

type TipMove = Pick<AnalysedMove, 'ply' | 'color' | 'uci'> & { best?: { san: string } };

/** Who a sentence is about: "you"/"they" next to a reader, "White"/"Black" otherwise. */
interface Who {
  subj: string;
  /** Object form: you / them / White. */
  obj: string;
  poss: string;
  /** Verb form: `v('take', 'takes')`. */
  v: (plural: string, singular: string) => string;
}

function who(side: Side, perspective: Side | null): Who {
  if (perspective === null) {
    const n = side === 'w' ? 'White' : 'Black';
    return { subj: n, obj: n, poss: `${n}'s`, v: (_p, s) => s };
  }
  return perspective === side
    ? { subj: 'you', obj: 'you', poss: 'your', v: (p) => p }
    : { subj: 'they', obj: 'them', poss: 'their', v: (p) => p };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pick = <T,>(options: T[], ply: number): T => options[ply % options.length];
const pieceName = (t: PieceSymbol | undefined) => (t ? PIECE_NAME[t] : 'piece');
const pointsWord = (n: number) => `${n} point${n === 1 ? '' : 's'}`;
const mateWord = (n: number) => (n <= 1 ? 'checkmate next move' : `checkmate in ${n}`);

function setup(move: TipMove, insight: MoveInsight | undefined, perspective: Side | null) {
  const me = who(move.color, perspective);
  const them = who(move.color === 'w' ? 'b' : 'w', perspective);
  const onTarget = !!insight?.square && insight.square === move.uci.slice(2, 4);
  return { me, them, onTarget, ply: move.ply };
}

/** One or two sentences under "c3 is a mistake". '' when there is nothing verified to add. */
export function coachMoveText(move: TipMove, insight: MoveInsight | undefined, perspective: Side | null): string {
  if (!insight) return '';
  const { me, them, onTarget, ply } = setup(move, insight, perspective);
  const piece = pieceName(insight.piece);
  const sq = insight.square;
  const n = insight.material ?? 0;
  const mate = mateWord(insight.mateIn ?? 1);
  switch (insight.motif) {
    case 'allows-mate':
      return pick([
        `That lets ${them.obj} force ${mate}.`,
        `${cap(them.subj)} can now force ${mate}.`,
        `After this, ${them.subj} ${them.v('have', 'has')} a forced ${mate}.`,
      ], ply);
    case 'misses-mate':
      return pick([`${cap(me.subj)} had a forced ${mate} here.`, `There was a forced ${mate} on the board.`], ply);
    case 'hangs-piece':
      return onTarget
        ? pick([
            `That puts ${me.poss} ${piece} on ${sq} where it can just be captured.`,
            `${cap(me.poss)} ${piece} on ${sq} can be taken for free there.`,
          ], ply)
        : pick([
            `That leaves ${me.poss} ${piece} on ${sq} hanging. ${cap(them.subj)} can just take it.`,
            `${cap(me.poss)} ${piece} on ${sq} is left without enough protection.`,
            `Watch the ${piece} on ${sq}: ${them.subj} can win it now.`,
          ], ply);
    case 'misses-free-piece':
      return pick([`${cap(me.subj)} could have won a free ${piece} on ${sq}.`, `The ${piece} on ${sq} was up for grabs.`], ply);
    case 'loses-material':
      return pick([
        `This costs ${me.subj} about ${pointsWord(n)} of material.`,
        `${cap(me.subj)} ${me.v('end up', 'ends up')} about ${pointsWord(n)} down after this.`,
      ], ply);
    case 'misses-material':
      return pick([
        `There was a way to win about ${pointsWord(n)} of material.`,
        `${cap(me.subj)} could have come out about ${pointsWord(n)} ahead.`,
      ], ply);
    case 'walks-into-fork':
      return pick([
        `That lets ${them.poss} ${piece} jump to ${sq} and attack two of ${me.poss} pieces at once.`,
        `${cap(them.poss)} ${piece} can land on ${sq} and hit two targets together.`,
      ], ply);
    case 'lets-off-hook':
      return pick([
        `${cap(me.subj)} had a real chance after the last move, and this lets it slip.`,
        `This does not make the most of ${them.poss} last move.`,
      ], ply);
    case 'throws-win':
      return pick([
        `${cap(me.subj)} ${me.v('were', 'was')} winning, and this gives most of it away.`,
        `This throws away a winning position.`,
      ], ply);
    case 'drifts':
      return pick([`This lets ${me.poss} position slip a little.`, `A steadier move was available.`], ply);
    case 'sacrifice':
      return pick([
        `${cap(me.subj)} ${me.v('offer', 'offers')} the ${piece} on ${sq}, but taking it does not work out.`,
        `A bold ${piece} sacrifice that pays off.`,
      ], ply);
    case 'only-move':
      return pick([`The only move that keeps the advantage.`, `Everything else lets the edge slip.`], ply);
    case 'checkmate':
      return pick([`That is checkmate.`, `Checkmate, game over.`], ply);
    case 'wins-free-piece':
      return pick([`That wins a free ${piece} on ${sq}.`, `The ${piece} on ${sq} was there for the taking.`], ply);
    case 'book':
      return pick([`A standard opening move.`, `Well-known opening theory.`], ply);
    case 'forced':
      return `It was the only legal move.`;
    default:
      return '';
  }
}

/** Explain: what the move allows, naming the opponent's reply. '' when nothing is verified. */
export function coachExplainText(move: TipMove, insight: MoveInsight | undefined, perspective: Side | null): string {
  if (!insight) return '';
  const { me, them, ply } = setup(move, insight, perspective);
  const piece = pieceName(insight.piece);
  const n = insight.material ?? 0;
  const reply = insight.replySan;
  const mate = mateWord(insight.mateIn ?? 1);
  const down =
    insight.piece && insight.piece !== 'p' && n === PIECE_VALUE[insight.piece] ? `a ${piece} down` : `${pointsWord(n)} of material down`;
  switch (insight.motif) {
    case 'allows-mate':
      return reply
        ? pick([
            `After ${reply} the mate cannot be stopped: ${mate}.`,
            `${cap(them.subj)} ${them.v('play', 'plays')} ${reply}, and ${mate} is forced.`,
          ], ply)
        : `The mate cannot be stopped: ${mate}.`;
    case 'misses-mate':
      return `The engine found a forced ${mate}. Playing something else gave it up.`;
    case 'hangs-piece':
      return reply
        ? pick([
            `After ${reply} ${me.subj} ${me.v('are', 'is')} ${down}.`,
            `${cap(them.subj)} ${them.v('play', 'plays')} ${reply} and ${me.subj} ${me.v('end up', 'ends up')} ${down}.`,
          ], ply)
        : `${cap(me.subj)} ${me.v('lose', 'loses')} the ${piece}.`;
    case 'loses-material':
      return reply
        ? `After ${reply}, the engine line leaves ${me.subj} about ${pointsWord(n)} down.`
        : `The engine line leaves ${me.subj} about ${pointsWord(n)} down.`;
    case 'walks-into-fork':
      return `After ${reply ?? 'that reply'}, two pieces are attacked at once and ${me.subj} cannot save both. The engine line loses about ${pointsWord(n)}.`;
    case 'misses-free-piece':
      return `The ${piece} on ${insight.square} was not protected enough, and this move left it alone.`;
    case 'misses-material':
      return `The engine line wins about ${pointsWord(n)} of material from here.`;
    case 'lets-off-hook':
      return `The last move gave ${me.subj} a chance. After this one the position is balanced again.`;
    case 'throws-win':
      return `The engine rated ${me.poss} position as clearly winning before this move, and only slightly better afterwards.`;
    case 'drifts':
      return `Nothing is lost outright, but the engine prefers another move here.`;
    default:
      return coachMoveText(move, insight, perspective);
  }
}

type BestInfo = NonNullable<MoveInsight['best']>;
const BEST_ENDINGS: Record<BestReason, (san: string, b: BestInfo, poss: string) => string[]> = {
  mates: (san, b) =>
    b.mateIn === 1
      ? [`${san} is checkmate.`]
      : [`${san} starts a forced ${mateWord(b.mateIn ?? 1)}.`, `${san} leads to ${mateWord(b.mateIn ?? 1)}.`],
  'wins-piece': (san, b) => [`${san} wins the ${pieceName(b.piece)} on ${b.square}.`, `${san} picks up the ${pieceName(b.piece)} on ${b.square}.`],
  'wins-material': (san, b) => [`${san} wins about ${pointsWord(b.material ?? 0)} of material.`, `${san} comes out ahead by about ${pointsWord(b.material ?? 0)}.`],
  'saves-piece': (san, b) => [`${san} moves the ${pieceName(b.piece)} out of danger.`, `${san} gets the ${pieceName(b.piece)} to safety.`],
  'stops-mate': (san) => [`${san} stops the checkmate threat.`, `${san} keeps the king out of a mating attack.`],
  defends: (san, b) => [`${san} keeps the ${pieceName(b.piece)} on ${b.square} from being lost.`, `${san} makes sure the ${pieceName(b.piece)} on ${b.square} is not lost.`],
  castles: (san) => [`${san} tucks the king away and brings a rook into play.`, `${san} gets the king safe.`],
  develops: (san, b) => [`${san} brings the ${pieceName(b.piece)} into the game.`, `${san} develops a piece.`],
  'trades-when-ahead': (san) => [`${san} trades pieces, which helps the side that is ahead.`],
  'keeps-advantage': (san, _b, poss) => [`${san} keeps ${poss} edge.`, `${san} holds on to the advantage.`],
  holds: (san) => [`${san} keeps the position together.`, `${san} is the most solid choice.`],
};

/** Best: why the engine's move is better. '' without a best move. */
export function coachBestText(move: TipMove, insight: MoveInsight | undefined, perspective: Side | null): string {
  const best = insight?.best;
  const san = move.best?.san;
  if (!best || !san) return '';
  const { me, ply } = setup(move, insight, perspective);
  return pick(BEST_ENDINGS[best.reason](san, best, me.poss), ply);
}

/** Retry: 'best' = the engine's first move, 'good' = another line within LOSS_EXCELLENT of it, else 'wrong'. */
export function judgeRetry(evalBefore: PositionEval, uci: string, mover: Side): 'best' | 'good' | 'wrong' {
  const top = evalBefore.lines[0];
  if (!top) return 'wrong';
  if (top.pv[0] === uci) return 'best';
  const match = evalBefore.lines.find((l) => l.pv[0] === uci);
  if (match && expectedPointsLoss(top.score, match.score, mover) < LOSS_EXCELLENT) return 'good';
  return 'wrong';
}
