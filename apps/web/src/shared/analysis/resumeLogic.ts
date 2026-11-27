import type { GameReport, PositionEval } from '@knightfall/core';

/** Finished evaluations of an unfinished run, kept in memory so the next run of the same game can continue from them. */
export interface PartialRun {
  engine: string;
  depth: number;
  evals: readonly (PositionEval | undefined)[];
}

/** What the screen shows for a finished (stored) analysis. */
export interface DoneView<E extends string = string> {
  report: GameReport;
  evals: readonly (PositionEval | undefined)[];
  engine: E;
  depth: number;
  analysedAt: number | null;
  staleEngine: boolean;
}

export function countEvals(evals: readonly (PositionEval | undefined)[]): number {
  let n = 0;
  for (const e of evals) if (e) n++;
  return n;
}

/** The evaluations to reuse for a new run, or undefined when there are none for this engine, depth and game length. */
export function knownFromPartial(partial: PartialRun | null, engine: string, depth: number, total: number): (PositionEval | undefined)[] | undefined {
  if (!partial || partial.engine !== engine || partial.depth !== depth || partial.evals.length !== total) return undefined;
  return countEvals(partial.evals) > 0 ? partial.evals.slice() : undefined;
}

/** The snapshot fields to show when a run stops or fails: the previous good analysis when there was one, else the error. */
export function interruptedPatch<E extends string>(previous: DoneView<E> | null, error: string) {
  if (!previous) return { status: 'error' as const, error };
  const total = previous.evals.length;
  return { status: 'done' as const, error: null, report: previous.report, evals: previous.evals, done: total, total, engine: previous.engine, depth: previous.depth, analysedAt: previous.analysedAt, staleEngine: previous.staleEngine };
}
