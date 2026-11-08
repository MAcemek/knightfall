/** Glicko-2 rating system (Glickman), single-game updates. */
export interface Glicko {
  rating: number;
  rd: number;
  vol: number;
}

export const DEFAULT_GLICKO: Glicko = { rating: 1200, rd: 350, vol: 0.06 };

const SCALE = 173.7178;
const TAU = 0.5;
const EPS = 0.000001;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * Update a player's rating after one result against an opponent (or puzzle).
 * score: 1 = win/solved, 0 = loss/failed, 0.5 = draw.
 */
export function glickoUpdate(player: Glicko, opponentRating: number, opponentRd: number, score: number): Glicko {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const muJ = (opponentRating - 1500) / SCALE;
  const phiJ = opponentRd / SCALE;
  const sigma = player.vol;

  const gJ = g(phiJ);
  const eJ = E(mu, muJ, phiJ);
  const v = 1 / (gJ * gJ * eJ * (1 - eJ));
  const delta = v * gJ * (score - eJ);

  // Volatility iteration (Illinois algorithm)
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * Math.pow(phi * phi + v + ex, 2)) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > EPS && guard++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * gJ * (score - eJ);

  return {
    rating: newMu * SCALE + 1500,
    // Floor the RD so ratings keep moving, like most puzzle trainers.
    rd: Math.max(45, Math.min(350, newPhi * SCALE)),
    vol: Math.min(0.1, newSigma),
  };
}

/** Largest rating swing a single puzzle can cause (keeps new players' first results from feeling brutal). */
export const MAX_PUZZLE_DELTA = 48;

/** Rating change (rounded, capped at ±MAX_PUZZLE_DELTA) for a puzzle attempt. */
export function puzzleRatingChange(player: Glicko, puzzleRating: number, solved: boolean): { next: Glicko; delta: number } {
  const raw = glickoUpdate(player, puzzleRating, 80, solved ? 1 : 0);
  const capped = Math.max(-MAX_PUZZLE_DELTA, Math.min(MAX_PUZZLE_DELTA, raw.rating - player.rating));
  const next = { ...raw, rating: player.rating + capped };
  return { next, delta: Math.round(next.rating) - Math.round(player.rating) };
}

/** Classic Elo update, used for Puzzle Battle rating. */
export function eloUpdate(rating: number, opponent: number, score: number, k = 32): number {
  const expected = 1 / (1 + Math.pow(10, (opponent - rating) / 400));
  return Math.round(rating + k * (score - expected));
}
