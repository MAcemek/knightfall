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
    if (decisive.material >= 3) return `${subject} won a piece in ${phase} and never let go.`;
    if (decisive.material >= 1) return `${subject} picked up material in ${phase} and kept control to the end.`;
    return `${subject} took charge in ${phase} and never looked back.`;
  }
  if (opts.result === '1/2-1/2') return 'A hard-fought draw. Both sides held their ground.';
  if (acc !== null && acc >= 90) return 'Sharp, accurate play from start to finish.';
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
/** Phrasings rotate with the ply, so two neighbouring moves never get the same sentence while another fits. */
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

type BestInfo = NonNullable<MoveInsight['best']>;

/** What the engine's move does, as a verb phrase that fits after "Nd2 ". Only facts the insight verified. */
const BEST_PLAN: Record<BestReason, (b: BestInfo, poss: string) => string[]> = {
  mates: (b) =>
    b.mateIn === 1
      ? ['is checkmate', 'ends the game with checkmate']
      : [`starts a forced ${mateWord(b.mateIn ?? 1)}`, `leads to ${mateWord(b.mateIn ?? 1)}`],
  'wins-piece': (b) => [`wins the ${pieceName(b.piece)} on ${b.square}`, `picks up the ${pieceName(b.piece)} on ${b.square}`, `takes the ${pieceName(b.piece)} on ${b.square} for free`],
  'wins-material': (b) => [`wins about ${pointsWord(b.material ?? 0)} of material`, `comes out ahead by about ${pointsWord(b.material ?? 0)}`],
  'saves-piece': (b) => [`moves the ${pieceName(b.piece)} out of danger`, `gets the ${pieceName(b.piece)} to safety`, `rescues the ${pieceName(b.piece)} before it is lost`],
  'stops-mate': () => ['stops the checkmate threat', 'keeps the king out of a mating attack'],
  defends: (b) => [`keeps the ${pieceName(b.piece)} on ${b.square} from being lost`, `makes sure the ${pieceName(b.piece)} on ${b.square} is not lost`, `defends the ${pieceName(b.piece)} on ${b.square}`],
  castles: () => ['tucks the king away and brings a rook into play', 'gets the king safe'],
  develops: (b) => [`brings the ${pieceName(b.piece)} into the game`, `develops the ${pieceName(b.piece)}`, `gets the ${pieceName(b.piece)} off its starting square`],
  'trades-when-ahead': () => ['trades pieces, which helps the side that is ahead', 'simplifies while ahead'],
  'keeps-advantage': (_b, poss) => [`keeps ${poss} edge`, 'holds on to the advantage'],
  holds: () => ['keeps the position together', 'is the most solid choice'],
};

/** "Better was Nd2, which develops the knight." when the engine's move and its reason are known, else nothing. */
function betterSentence(move: TipMove, insight: MoveInsight, poss: string, ply: number): string[] {
  const san = move.best?.san;
  if (!san || !insight.best) return [];
  const plan = pick(BEST_PLAN[insight.best.reason](insight.best, poss), ply);
  return [`Better was ${san}, which ${plan}.`];
}

/** One or two sentences under "c3 is a mistake". '' when there is nothing verified to add. */
export function coachMoveText(move: TipMove, insight: MoveInsight | undefined, perspective: Side | null): string {
  if (!insight) return '';
  const { me, them, onTarget, ply } = setup(move, insight, perspective);
  const piece = pieceName(insight.piece);
  const sq = insight.square;
  const n = insight.material ?? 0;
  const mate = mateWord(insight.mateIn ?? 1);
  const better = () => betterSentence(move, insight, me.poss, ply);
  switch (insight.motif) {
    case 'allows-mate':
      return pick([
        `That lets ${them.obj} force ${mate}.`,
        `${cap(them.subj)} can now force ${mate}.`,
        `After this, ${them.subj} ${them.v('have', 'has')} a forced ${mate}.`,
        `${cap(me.poss)} king is in a forced mating net: ${mate}.`,
      ], ply);
    case 'misses-mate':
      return pick([
        `${cap(me.subj)} had a forced ${mate} here.`,
        `There was a forced ${mate} on the board.`,
        `A forced ${mate} was there, and this move lets it go.`,
      ], ply);
    case 'hangs-piece':
      return onTarget
        ? pick([
            `That puts ${me.poss} ${piece} on ${sq} where it can just be captured.`,
            `${cap(me.poss)} ${piece} on ${sq} can be taken for free there.`,
            `Moving to ${sq} leaves ${me.poss} ${piece} open to capture.`,
          ], ply)
        : pick([
            `That leaves ${me.poss} ${piece} on ${sq} hanging. ${cap(them.subj)} can just take it.`,
            `${cap(me.poss)} ${piece} on ${sq} is left without enough protection.`,
            `Watch the ${piece} on ${sq}: ${them.subj} can win it now.`,
            `Nothing guards ${me.poss} ${piece} on ${sq} well enough, so ${them.subj} can win it.`,
          ], ply);
    case 'misses-free-piece':
      return pick([
        `${cap(me.subj)} could have won a free ${piece} on ${sq}.`,
        `The ${piece} on ${sq} was up for grabs.`,
        `A free ${piece} on ${sq} was there to be taken.`,
      ], ply);
    case 'loses-material':
      return pick([
        `This costs ${me.subj} about ${pointsWord(n)} of material.`,
        `${cap(me.subj)} ${me.v('end up', 'ends up')} about ${pointsWord(n)} down after this.`,
        `${cap(them.subj)} ${them.v('come', 'comes')} out about ${pointsWord(n)} ahead after this.`,
        ...better(),
      ], ply);
    case 'misses-material':
      return pick([
        `There was a way to win about ${pointsWord(n)} of material.`,
        `${cap(me.subj)} could have come out about ${pointsWord(n)} ahead.`,
        `The best move wins about ${pointsWord(n)} of material.`,
      ], ply);
    case 'walks-into-fork':
      return pick([
        `That lets ${them.poss} ${piece} jump to ${sq} and attack two of ${me.poss} pieces at once.`,
        `${cap(them.poss)} ${piece} can land on ${sq} and hit two targets together.`,
        `A fork is coming: ${them.poss} ${piece} on ${sq} will attack two pieces.`,
      ], ply);
    case 'lets-off-hook':
      return pick([
        `${cap(me.subj)} had a real chance after the last move, and this lets it slip.`,
        `This does not make the most of ${them.poss} last move.`,
        ...better(),
      ], ply);
    case 'throws-win':
      return pick([
        `${cap(me.subj)} ${me.v('were', 'was')} winning, and this gives most of it away.`,
        `This throws away a winning position.`,
        ...better(),
      ], ply);
    case 'drifts':
      return pick([`This weakens ${me.poss} position.`, `A steadier move was available.`, ...better()], ply);
    case 'sacrifice':
      return pick([
        `${cap(me.subj)} ${me.v('offer', 'offers')} the ${piece} on ${sq}, but taking it does not work out.`,
        `A bold sacrifice of the ${piece} on ${sq} that pays off.`,
        `The ${piece} on ${sq} is given up, and the engine confirms it pays off.`,
      ], ply);
    case 'only-move':
      return pick([
        `The only move that holds the position.`,
        `Everything else is clearly worse.`,
        `The only move here that keeps ${me.poss} position safe.`,
      ], ply);
    case 'checkmate':
      return pick([`That is checkmate.`, `Checkmate, game over.`, `That ends the game: checkmate.`], ply);
    case 'wins-free-piece':
      return pick([
        `That wins a free ${piece} on ${sq}.`,
        `The ${piece} on ${sq} was there for the taking.`,
        `Nothing guarded the ${piece} on ${sq}, and this takes it.`,
      ], ply);
    case 'book':
      return pick([`A standard opening move.`, `Well-known opening theory.`, `A move players have chosen here for years.`], ply);
    case 'forced':
      return pick([`It was the only legal move.`, `There was no other legal move.`], ply);
    default:
      return '';
  }
}

/** Explain: what the move allows, naming the opponent's reply. '' when nothing is verified. */
export function coachExplainText(move: TipMove, insight: MoveInsight | undefined, perspective: Side | null): string {
  if (!insight) return '';
  const { me, them, ply } = setup(move, insight, perspective);
  const piece = pieceName(insight.piece);
  const sq = insight.square;
  const n = insight.material ?? 0;
  const reply = insight.replySan;
  const mate = mateWord(insight.mateIn ?? 1);
  const best = move.best?.san;
  const down =
    insight.piece && insight.piece !== 'p' && n === PIECE_VALUE[insight.piece] ? `a ${piece} down` : `${pointsWord(n)} of material down`;
  switch (insight.motif) {
    case 'allows-mate':
      // With the mate in one, the reply is the checkmate itself: nothing follows it.
      if (reply && (insight.mateIn ?? 1) <= 1) {
        return pick([
          `After ${reply} it is checkmate.`,
          `${cap(them.subj)} ${them.v('play', 'plays')} ${reply}, and that is checkmate.`,
          `Best play for ${them.obj} is ${reply}, which is checkmate.`,
        ], ply);
      }
      return reply
        ? pick([
            `After ${reply} the mate cannot be stopped: ${mate}.`,
            `${cap(them.subj)} ${them.v('play', 'plays')} ${reply}, and ${mate} is forced.`,
            `Best play for ${them.obj} is ${reply}, and ${mate} follows.`,
          ], ply)
        : pick([`The mate cannot be stopped: ${mate}.`, `Nothing stops ${mate} after this.`], ply);
    case 'misses-mate':
      return pick([
        `The engine found a forced ${mate}. Playing something else gave it up.`,
        `A forced ${mate} was on the board, and this move missed it.`,
        ...(insight.best?.reason === 'mates' && best ? [`${best} started a forced ${mate}. This move gave it up.`] : []),
      ], ply);
    case 'hangs-piece': {
      const takes = !!reply && reply.includes('x') && insight.threat?.to === sq;
      return reply
        ? pick([
            ...(takes ? [`${cap(them.subj)} ${them.v('play', 'plays')} ${reply}, taking the ${piece} on ${sq}, and ${me.subj} ${me.v('are', 'is')} ${down}.`] : []),
            `After ${reply} ${me.subj} ${me.v('are', 'is')} ${down}.`,
            `${cap(them.subj)} ${them.v('play', 'plays')} ${reply} and ${me.subj} ${me.v('end up', 'ends up')} ${down}.`,
          ], ply)
        : `${cap(me.subj)} ${me.v('lose', 'loses')} the ${piece}.`;
    }
    case 'loses-material':
      return reply
        ? pick([
            `After ${reply}, the engine line leaves ${me.subj} about ${pointsWord(n)} down.`,
            `${cap(them.subj)} ${them.v('play', 'plays')} ${reply} and ${them.v('come', 'comes')} out about ${pointsWord(n)} ahead.`,
          ], ply)
        : `The engine line leaves ${me.subj} about ${pointsWord(n)} down.`;
    case 'walks-into-fork':
      return reply
        ? pick([
            `After ${reply}, two pieces are attacked at once and ${me.subj} cannot save both. The engine line loses about ${pointsWord(n)}.`,
            `${cap(them.subj)} ${them.v('play', 'plays')} ${reply}: the ${piece} on ${sq} attacks two pieces, and the engine line loses about ${pointsWord(n)}.`,
          ], ply)
        : `Two pieces are attacked at once and ${me.subj} cannot save both. The engine line loses about ${pointsWord(n)}.`;
    case 'misses-free-piece':
      return pick([
        `The ${piece} on ${sq} was not protected enough, and this move left it alone.`,
        `${cap(me.subj)} could have taken the ${piece} on ${sq} for free instead.`,
        ...(insight.best?.reason === 'wins-piece' && best ? [`${best} would have won the ${piece} on ${sq}.`] : []),
      ], ply);
    case 'misses-material':
      return pick([
        `The engine line wins about ${pointsWord(n)} of material from here.`,
        `A line that wins about ${pointsWord(n)} of material was available.`,
        ...(best ? [`${best} starts a line that wins about ${pointsWord(n)} of material.`] : []),
      ], ply);
    case 'lets-off-hook':
      return pick([
        `The last move gave ${me.subj} a chance. After this one the lead is smaller.`,
        `The position favoured ${me.obj} before this move, and less so after it.`,
      ], ply);
    case 'throws-win':
      return pick([
        `The engine rated ${me.poss} position as clearly winning before this move, and no longer winning afterwards.`,
        `Before this move the engine saw a clear win for ${me.obj}. After it, the win is gone.`,
      ], ply);
    case 'drifts':
      return pick([
        `Nothing is lost outright, but the engine prefers another move here.`,
        `The engine rates another move higher here, though nothing is lost outright.`,
        ...(best ? [`Nothing is lost outright, but the engine prefers ${best}.`] : []),
      ], ply);
    default:
      return coachMoveText(move, insight, perspective);
  }
}

/** Best: why the engine's move is better. '' without a best move. */
export function coachBestText(move: TipMove, insight: MoveInsight | undefined, perspective: Side | null): string {
  const best = insight?.best;
  const san = move.best?.san;
  if (!best || !san) return '';
  const { me, ply } = setup(move, insight, perspective);
  return `${san} ${pick(BEST_PLAN[best.reason](best, me.poss), ply)}.`;
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
