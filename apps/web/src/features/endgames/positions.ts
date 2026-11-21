/**
 * Curated endgame drills. In every position the trainee (`side`) is to move; the tablebase plays the other side.
 * Each FEN was checked against tablebase.lichess.ovh: wins are a 'win' for the trainee, draws a 'draw'
 * (positions.test.ts pins those answers in a fixture, so the tests never touch the network).
 */

export type EndgameGroup = 'mates' | 'pawns' | 'rooks' | 'queens';
export type EndgameGoal = 'win' | 'draw';

export interface EndgamePosition {
  id: string;
  group: EndgameGroup;
  title: string;
  /** win: deliver checkmate. draw: hold the draw until the game ends or `holdMoves` moves have been played. */
  goal: EndgameGoal;
  /** The trainee. Always the side to move in `fen`. */
  side: 'w' | 'b';
  fen: string;
  hint: string;
  difficulty: 1 | 2 | 3;
  /** Draws only: how many of your moves count as holding. */
  holdMoves?: number;
}

export const ENDGAME_GROUPS: readonly { id: EndgameGroup; title: string; blurb: string }[] = [
  { id: 'mates', title: 'Basic mates', blurb: 'Force checkmate against the best defence.' },
  { id: 'pawns', title: 'Pawn endings', blurb: 'Opposition, key squares and fortresses.' },
  { id: 'rooks', title: 'Rook endings', blurb: 'The classic positions every player should know.' },
  { id: 'queens', title: 'Queen endings', blurb: 'Queen against pawn and rook.' },
];

export const ENDGAMES: readonly EndgamePosition[] = [
  {
    id: 'kqk',
    group: 'mates',
    title: 'King and queen v king',
    goal: 'win',
    side: 'w',
    fen: '8/8/8/4k3/8/8/2Q5/4K3 w - - 0 1',
    hint: 'Box the king in a knight\'s move away, then bring your own king close. Watch for stalemate.',
    difficulty: 1,
  },
  {
    id: 'krk',
    group: 'mates',
    title: 'King and rook v king',
    goal: 'win',
    side: 'w',
    fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    hint: 'Cut the king off along a rank, then walk your king opposite theirs and check from afar.',
    difficulty: 1,
  },
  {
    id: 'kbbk',
    group: 'mates',
    title: 'Two bishops v king',
    goal: 'win',
    side: 'w',
    fen: '8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1',
    hint: 'Keep the bishops side by side on neighbouring diagonals and push the king to a corner.',
    difficulty: 2,
  },
  {
    id: 'kbnk',
    group: 'mates',
    title: 'Bishop and knight v king',
    goal: 'win',
    side: 'w',
    fen: '8/8/8/4k3/8/8/8/1N2KB2 w - - 0 1',
    hint: 'Mate only works in a corner the bishop controls. Drive the king there, using the W manoeuvre with the knight.',
    difficulty: 3,
  },
  {
    id: 'key-squares',
    group: 'pawns',
    title: 'Reach the key square',
    goal: 'win',
    side: 'w',
    fen: '4k3/8/3K4/4P3/8/8/8/8 w - - 0 1',
    hint: 'Your king is already in front of the pawn. Keep it there and let the pawn follow.',
    difficulty: 1,
  },
  {
    id: 'opposition',
    group: 'pawns',
    title: 'Win the opposition',
    goal: 'win',
    side: 'w',
    fen: '8/8/8/2k5/8/8/3PK3/8 w - - 0 1',
    hint: 'Only one move wins. Get your king ahead of the pawn without giving the black king the opposition.',
    difficulty: 2,
  },
  {
    id: 'outside-passer',
    group: 'pawns',
    title: 'The outside passed pawn',
    goal: 'win',
    side: 'w',
    fen: '8/5pk1/8/8/8/P7/4K3/8 w - - 0 1',
    hint: 'Push the a-pawn to drag the black king away, then your king takes the other pawn.',
    difficulty: 2,
  },
  {
    id: 'rook-pawn',
    group: 'pawns',
    title: 'The rook-pawn draw',
    goal: 'draw',
    side: 'b',
    fen: '7k/8/5K2/7P/8/8/8/8 b - - 0 1',
    hint: 'A rook pawn cannot win if you stay in the corner. Shuffle between g8 and h8 and never leave.',
    difficulty: 1,
    holdMoves: 8,
  },
  {
    id: 'wrong-bishop',
    group: 'pawns',
    title: 'The wrong-coloured bishop',
    goal: 'draw',
    side: 'b',
    fen: '7k/8/6K1/7P/8/8/8/5B2 b - - 0 1',
    hint: 'The bishop does not control h8, so the king can sit in the corner. Never step out of it.',
    difficulty: 1,
    holdMoves: 8,
  },
  {
    id: 'blockade',
    group: 'pawns',
    title: 'Blockade the pawn',
    goal: 'draw',
    side: 'b',
    fen: '8/8/3k4/3P4/3K4/8/8/8 b - - 0 1',
    hint: 'Keep your king on the key squares in front of the pawn and answer each king move with the opposition.',
    difficulty: 2,
    holdMoves: 12,
  },
  {
    id: 'lucena',
    group: 'rooks',
    title: 'Lucena position',
    goal: 'win',
    side: 'w',
    fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
    hint: 'Build a bridge: check on the file to push the king away, then bring your rook to the fourth rank.',
    difficulty: 3,
  },
  {
    id: 'philidor',
    group: 'rooks',
    title: 'Philidor position',
    goal: 'draw',
    side: 'b',
    fen: '4k3/8/r7/3PK3/8/8/8/3R4 b - - 0 1',
    hint: 'Keep the rook on the sixth rank until the pawn moves, then check from behind.',
    difficulty: 2,
    holdMoves: 15,
  },
  {
    id: 'vancura',
    group: 'rooks',
    title: 'Vancura position',
    goal: 'draw',
    side: 'b',
    fen: '8/8/P4k1r/8/8/8/6K1/R7 b - - 0 1',
    hint: 'Attack the a-pawn from the side with your rook and keep checking from a distance.',
    difficulty: 3,
    holdMoves: 15,
  },
  {
    id: 'rook-v-pawn',
    group: 'rooks',
    title: 'Rook v pawn on the second',
    goal: 'win',
    side: 'w',
    fen: '8/8/8/8/8/1k6/6p1/4K2R w - - 0 1',
    hint: 'Cover the queening square first. Then use your king to help the rook.',
    difficulty: 2,
  },
  {
    id: 'rook-v-bishop',
    group: 'rooks',
    title: 'Bishop holds against the rook',
    goal: 'draw',
    side: 'b',
    fen: '8/8/8/4k3/8/8/b7/R3K3 b - - 0 1',
    hint: 'Keep the king and bishop together and stay off the edge where the rook can pin the bishop.',
    difficulty: 3,
    holdMoves: 20,
  },
  {
    id: 'queen-v-pawn-win',
    group: 'queens',
    title: 'Queen v bishop pawn, king close',
    goal: 'win',
    side: 'w',
    fen: '8/8/8/8/8/1Q6/2p5/K2k4 w - - 0 1',
    hint: 'Check the king in front of the pawn so it blocks the pawn, then walk your king closer.',
    difficulty: 3,
  },
  {
    id: 'queen-v-pawn-draw',
    group: 'queens',
    title: 'Queen v bishop pawn, king far',
    goal: 'draw',
    side: 'b',
    fen: '8/8/8/4Q3/6K1/8/1kp5/8 b - - 0 1',
    hint: 'With the white king far away, stay next to the pawn and look for stalemate tricks.',
    difficulty: 3,
    holdMoves: 12,
  },
  {
    id: 'queen-v-rook',
    group: 'queens',
    title: 'Queen v rook',
    goal: 'win',
    side: 'w',
    fen: '8/8/8/4k3/8/8/r7/3QK3 w - - 0 1',
    hint: 'Fork the king and rook with checks, and do not let the rook defend from a distance.',
    difficulty: 2,
  },
  {
    id: 'queen-v-rook-hard',
    group: 'queens',
    title: 'Queen v rook, far from the rook',
    goal: 'win',
    side: 'w',
    fen: '8/8/8/8/8/2k5/r7/3QK3 w - - 0 1',
    hint: 'Your king has to come closer before the queen can win the rook. Beware of stalemate and skewers.',
    difficulty: 3,
  },
];

export function findEndgame(id: string | undefined): EndgamePosition | undefined {
  return ENDGAMES.find((p) => p.id === id);
}
