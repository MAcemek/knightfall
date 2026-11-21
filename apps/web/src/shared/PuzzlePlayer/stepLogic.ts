import type { RunnerStatus } from './usePuzzleRunner.ts';

/**
 * Which plies of a puzzle line can be viewed with Back/Forward, per runner phase.
 *
 * A "view index" v means: the board shows the position after the first v plies of `puzzle.moves`
 * (0 = the puzzle's starting FEN, i.e. before the opponent's setup move when `opponentFirst`).
 * `live` is the number of plies actually played so far.
 *
 * - 'player' (puzzle in progress, solver to move): viewable range is 0..live. Forward stops at the live
 *   position, where the view ends (the board becomes interactive again).
 * - 'solved' / 'solution': the whole line, 0..total (the existing post-puzzle stepper).
 * - every other phase (idle, intro, opponent reply pending, failed hold): not steppable, because a
 *   timer is about to change the position and stepping would fight it.
 */
export function isSteppable(status: RunnerStatus): boolean {
  return status === 'player' || status === 'solved' || status === 'solution';
}

/** Highest ply that can be viewed in this phase. */
export function maxView(status: RunnerStatus, live: number, total: number): number {
  const l = Math.min(Math.max(live, 0), total);
  return status === 'player' ? l : total;
}

export interface StepAbility {
  steppable: boolean;
  canBack: boolean;
  canForward: boolean;
}

/** `view` is the ply currently being viewed, or null when the board shows the live position. */
export function stepAbility(status: RunnerStatus, view: number | null, live: number, total: number): StepAbility {
  if (!isSteppable(status)) return { steppable: false, canBack: false, canForward: false };
  const max = maxView(status, live, total);
  const cur = view ?? Math.min(Math.max(live, 0), total);
  return { steppable: true, canBack: cur > 0, canForward: cur < max };
}

/** The view index after stepping one ply in `dir`, or null when that step is not available. */
export function stepTarget(status: RunnerStatus, view: number | null, live: number, total: number, dir: 1 | -1): number | null {
  const a = stepAbility(status, view, live, total);
  if (dir === -1 ? !a.canBack : !a.canForward) return null;
  const cur = view ?? Math.min(Math.max(live, 0), total);
  return cur + dir;
}

/**
 * Whether the view returns to the live board after a step to `target`. Only while the puzzle is in
 * progress: after it ends, the finished line stays in review mode so the stepper keeps its index.
 */
export function returnsToLive(status: RunnerStatus, target: number, live: number): boolean {
  return status === 'player' && target >= live;
}

/** Whether the board accepts solving moves: only on the solver's turn and not while viewing an earlier ply. */
export function boardInteractive(status: RunnerStatus, viewing: boolean): boolean {
  return status === 'player' && !viewing;
}
