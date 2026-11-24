import type { AnalysedMove, GameReport } from '@knightfall/core';
import type { SelfReview, SelfReviewReason, StoredGame } from '../../../shared/db.ts';
import type { SelfReviewMode } from '../../../shared/settingsLogic.ts';
import { moveLabel } from '../review/reviewExtras.ts';

/** Pure rules of the engine-off review (no React, no IndexedDB): when to ask, what the player may mark, how it is compared. */

/** Speeds that count as slow games for the 'slow' mode (compared in lower case). */
const SLOW_SPEEDS: ReadonlySet<string> = new Set(['rapid', 'daily', 'classical', 'correspondence']);

/** Move classes of the engine's verdict that count as "the game turned here". */
const TURNING_CLASSES: ReadonlySet<string> = new Set(['mistake', 'miss', 'blunder']);

export function isSlowGame(game: Pick<StoredGame, 'source' | 'speed'>): boolean {
  return game.source === 'bot' || SLOW_SPEEDS.has((game.speed ?? '').trim().toLowerCase());
}

/**
 * Whether the game asks for the player's own review before the engine starts. Never when the setting is off,
 * the side is unknown, a stored analysis exists, or a row exists (submitted or skipped).
 */
export function needsSelfReview(p: {
  mode: SelfReviewMode;
  game: Pick<StoredGame, 'source' | 'speed'>;
  side: 'w' | 'b' | null;
  hasAnalysis: boolean;
  review: SelfReview | null | undefined;
}): boolean {
  if (p.mode === 'off' || p.side === null || p.hasAnalysis || p.review) return false;
  return p.mode === 'all' || isSlowGame(p.game);
}

/** Ply (index of the move) of the first move of `side` that the engine calls a mistake, miss or blunder; null when none. */
export function enginePoint(report: Pick<GameReport, 'moves'>, side: 'w' | 'b'): number | null {
  const m = report.moves.find((x) => x.color === side && TURNING_CLASSES.has(x.class));
  return m ? m.ply : null;
}

export type Comparison = 'exact' | 'close' | 'earlier' | 'later' | 'engine-none' | 'missed' | 'both-none';

/** Two full moves apart (4 plies) still counts as close. */
const CLOSE_PLIES = 4;

export function compare(turningPly: number | null, engine: number | null): Comparison {
  if (turningPly === null) return engine === null ? 'both-none' : 'missed';
  if (engine === null) return 'engine-none';
  if (turningPly === engine) return 'exact';
  if (Math.abs(turningPly - engine) <= CLOSE_PLIES) return 'close';
  return turningPly < engine ? 'earlier' : 'later';
}

/** One plain sentence per outcome. `mine` and `engine` are move labels such as "12. Nf3". */
export function compareText(kind: Comparison, mine: string | null, engine: string | null): string {
  const a = mine ?? 'a move';
  const b = engine ?? 'a move';
  switch (kind) {
    case 'exact':
      return `You and the engine picked the same move, ${a}.`;
    case 'close':
      return `You picked ${a} and the engine picked ${b}. That is within two moves of each other.`;
    case 'earlier':
      return `You saw the turn early. You picked ${a}, and the engine picked ${b}, more than two moves later.`;
    case 'later':
      return `The engine saw the turn earlier. It picked ${b}, and you picked ${a}, more than two moves after it.`;
    case 'engine-none':
      return `You picked ${a}. The engine found no mistake, miss or blunder by you in this game.`;
    case 'missed':
      return `You marked no turning point. The engine found your first mistake at ${b}.`;
    case 'both-none':
      return 'You marked no turning point, and the engine found no mistake, miss or blunder by you.';
  }
}

export interface SelfReviewResult {
  kind: Comparison;
  /** Ply of the engine's point, or null. */
  enginePly: number | null;
  mineLabel: string | null;
  engineLabel: string | null;
  text: string;
}

/** Your point against the engine's, for the comparison card. */
export function selfReviewResult(row: Pick<SelfReview, 'side' | 'turningPly'>, report: GameReport): SelfReviewResult {
  const enginePly = enginePoint(report, row.side);
  const label = (ply: number | null) => {
    const m = ply === null ? undefined : report.moves[ply];
    return m ? moveLabel(m) : null;
  };
  const kind = compare(row.turningPly, enginePly);
  const mineLabel = label(row.turningPly);
  const engineLabel = label(enginePly);
  return { kind, enginePly, mineLabel, engineLabel, text: compareText(kind, mineLabel, engineLabel) };
}

/** Only the player's own moves can be the turning point. */
export function canMark(moves: readonly Pick<AnalysedMove, 'color'>[], index: number, side: 'w' | 'b'): boolean {
  return Number.isInteger(index) && index >= 0 && index < moves.length && moves[index].color === side;
}

export const REASONS: readonly { id: SelfReviewReason; label: string }[] = [
  { id: 'check', label: 'Missed their check' },
  { id: 'capture', label: 'Missed their capture' },
  { id: 'threat', label: 'Missed their threat' },
  { id: 'calculation', label: 'Miscalculated' },
  { id: 'time', label: 'Time trouble' },
  { id: 'plan', label: 'Wrong plan' },
  { id: 'opening', label: 'Opening' },
  { id: 'endgame', label: 'Endgame' },
];

export function reasonLabel(id: SelfReviewReason | null): string {
  return REASONS.find((r) => r.id === id)?.label ?? '';
}

export const MAX_LESSON = 200;
export const MIN_LESSON = 3;

/** Whitespace collapsed, trimmed, cut to MAX_LESSON. */
export function cleanLesson(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_LESSON).trim();
}

/** What the player picked in the gate: a move (index), or "there was none". */
export type Choice = { kind: 'move'; ply: number } | { kind: 'none' };

/** What still stops a submit, as a short sentence; null when it can be submitted. */
export function submitProblem(choice: Choice | null, reason: SelfReviewReason | null, lesson: string): string | null {
  if (!choice) return 'Mark a move, or choose that there was none.';
  if (choice.kind === 'move' && !reason) return 'Pick a reason.';
  if (cleanLesson(lesson).length < MIN_LESSON) return `Write your lesson (at least ${MIN_LESSON} characters).`;
  return null;
}

/** The row to store for a submit. Throws when submitProblem would not return null. */
export function buildSubmitted(p: { gameKey: string; side: 'w' | 'b'; choice: Choice | null; reason: SelfReviewReason | null; lesson: string; at: number }): SelfReview {
  if (!p.choice || submitProblem(p.choice, p.reason, p.lesson) !== null) throw new Error('The review is not complete.');
  const marked = p.choice.kind === 'move';
  return {
    gameKey: p.gameKey,
    at: p.at,
    side: p.side,
    turningPly: p.choice.kind === 'move' ? p.choice.ply : null,
    reason: marked ? p.reason : null,
    lesson: cleanLesson(p.lesson),
    skipped: false,
  };
}

/** The row to store for a skip. */
export function buildSkipped(p: { gameKey: string; side: 'w' | 'b'; at: number }): SelfReview {
  return { gameKey: p.gameKey, at: p.at, side: p.side, turningPly: null, reason: null, lesson: '', skipped: true };
}

/** A stored row that is safe to show, or null when it is missing or damaged. `plies` is the number of moves of the game. */
export function cleanSelfReviewRow(raw: unknown, plies: number): SelfReview | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.gameKey !== 'string' || (r.side !== 'w' && r.side !== 'b')) return null;
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
  if (r.skipped === true) return { gameKey: r.gameKey, at, side: r.side, turningPly: null, reason: null, lesson: '', skipped: true };
  let turningPly: number | null = null;
  if (r.turningPly !== null && r.turningPly !== undefined) {
    if (typeof r.turningPly !== 'number' || !Number.isInteger(r.turningPly) || r.turningPly < 0 || r.turningPly >= plies) return null;
    turningPly = r.turningPly;
  }
  const reason = REASONS.some((x) => x.id === r.reason) ? (r.reason as SelfReviewReason) : null;
  return { gameKey: r.gameKey, at, side: r.side, turningPly, reason, lesson: cleanLesson(r.lesson), skipped: false };
}
