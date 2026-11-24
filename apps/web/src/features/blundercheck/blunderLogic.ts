import { Chess, type Move } from 'chess.js';
import {
  addDays, centipawnLoss, uciToMove,
  type GameReport, type MoveClass, type PositionEval, type Puzzle, type Side,
} from '@knightfall/core';
import type { StoredGame } from '../../shared/db.ts';
import { judgePuzzleMove } from '../../shared/PuzzlePlayer/altLogic.ts';
import { resolveSide, type KnownUsers } from '../../shared/analysis/side.ts';
import { isDateKey } from '../../shared/localDate.ts';
import { judgeRetryMove } from '../analysis/review/retryLogic.ts';

/** Rules of the Blunder check drill: items, the balanced deck, verdicts, the enemy's forcing moves and the daily totals. No React, no board. */

export type Rng = () => number;
export type CheckSource = 'games' | 'puzzles';
export type CheckMode = 'quick' | 'full';
export type Said = 'safe' | 'blunder';
export type Outcome = 'correct' | 'wrong-reason' | 'missed' | 'false-alarm';

export interface CheckItem {
  id: string;
  source: CheckSource;
  /** The position BEFORE the planned move. */
  fen: string;
  /** The position after the planned move (the enemy to move). */
  fenAfter: string;
  planned: string;
  plannedSan: string;
  mover: Side;
  blunder: boolean;
  /** The refutation (UCI); null when the move is safe. */
  reply: string | null;
  /** The position after the planned move, when it is known. */
  evalAfter?: PositionEval;
  puzzle?: Puzzle;
  note: string;
  /** Game items: where to open the review. */
  gameKey?: string;
  ply?: number;
}

/** Centipawns a puzzle's first move must cost the player who made it to count as a blunder. */
export const PUZZLE_BLUNDER_CP = 150;
/** A puzzle's other line counts as safe within this many centipawns of the best line. */
export const SAFE_WINDOW_CP = 50;
/** Games need this many items before the drill can use them. */
export const MIN_GAME_ITEMS = 4;
/** ...and this many of each kind, so one item is never served again and again. */
export const MIN_GAME_KIND = 2;

const SAFE_CLASSES: readonly MoveClass[] = ['best', 'great', 'brilliant', 'excellent', 'good'];
const BLUNDER_CLASSES: readonly MoveClass[] = ['blunder', 'mistake'];
const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/* ---------------------------------- chess helpers ---------------------------------- */

function sideToMove(fen: string): Side {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Plays a UCI move on a FEN. Null when the FEN is invalid or the move is illegal. */
function playUci(fen: string, uci: string): { move: Move; fen: string } | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move(uciToMove(uci));
    return { move, fen: chess.fen() };
  } catch {
    return null;
  }
}

export function fenAfterMove(fen: string, uci: string): string | null {
  return playUci(fen, uci)?.fen ?? null;
}

export function sanOf(fen: string, uci: string): string | null {
  return playUci(fen, uci)?.move.san ?? null;
}

function legalCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 0;
  }
}

export interface ForcingMove {
  from: string;
  to: string;
  san: string;
  check: boolean;
  capture: boolean;
}

/** Every legal check and capture of the side to move, one per from+to square pair (promotion pieces count once). */
export function enemyForcing(fenAfter: string): ForcingMove[] {
  let moves: Move[];
  try {
    moves = new Chess(fenAfter).moves({ verbose: true });
  } catch {
    return [];
  }
  const byKey = new Map<string, ForcingMove>();
  for (const m of moves) {
    const check = m.san.includes('+') || m.san.includes('#');
    const capture = m.flags.includes('c') || m.flags.includes('e');
    if (!check && !capture) continue;
    const key = m.from + m.to;
    const old = byKey.get(key);
    if (old) {
      old.check = old.check || check;
      old.capture = old.capture || capture;
    } else byKey.set(key, { from: m.from, to: m.to, san: m.san, check, capture });
  }
  return [...byKey.values()];
}

/** The move is legal for the side to move and is a check or a capture. */
export function isForcingMove(fenAfter: string, uci: string): boolean {
  const key = uci.slice(0, 4);
  return enemyForcing(fenAfter).some((m) => m.from + m.to === key);
}

/* ---------------------------------- notes ---------------------------------- */

function pawns(cp: number): string {
  return (cp / 100).toFixed(1);
}

function blunderNote(fenAfter: string, reply: string, lossCp: number, mateAgainst: number | null): string {
  const played = playUci(fenAfter, reply);
  if (!played) return '';
  const taken = played.move.captured ? ` (it takes your ${PIECE_NAME[played.move.captured] ?? 'piece'})` : '';
  const head = `Best reply: ${played.move.san}${taken}.`;
  if (mateAgainst !== null) return `${head} It allows mate in ${mateAgainst}.`;
  if (lossCp >= 50) return `${head} You lose about ${pawns(lossCp)} pawns.`;
  return head;
}

/** Moves to mate against `mover` after the move, or null. */
function mateAgainstMover(evalAfter: PositionEval | undefined, mover: Side): number | null {
  const s = evalAfter?.score;
  if (!s || !('mate' in s)) return null;
  const against = mover === 'w' ? s.mate < 0 : s.mate > 0;
  return against ? Math.abs(s.mate) : null;
}

/* ---------------------------------- items from games ---------------------------------- */

export interface GameRow {
  game: StoredGame;
  report: GameReport;
}

/** Every usable blunder and safe item of the player's reviewed games, unordered. Rows without a known side are skipped. */
export function fromGames(rows: readonly GameRow[], users: KnownUsers): CheckItem[] {
  const out: CheckItem[] = [];
  const seen = new Set<string>();
  for (const { game, report } of rows) {
    const me = resolveSide(game, users);
    if (!me || report.evals.length !== report.moves.length + 1) continue;
    for (const move of report.moves) {
      if (move.color !== me) continue;
      const id = `g:${game.key}:${move.ply}`;
      if (seen.has(id)) continue;
      const evalAfter = report.evals[move.ply + 1];
      if (!evalAfter) continue;
      const isBlunder = BLUNDER_CLASSES.includes(move.class);
      const isSafe = SAFE_CLASSES.includes(move.class) || (move.class === 'book' && move.phase !== 'opening');
      if (!isBlunder && !isSafe) continue;
      if (sideToMove(move.fenBefore) !== me) continue;
      const base = {
        id, source: 'games' as const, fen: move.fenBefore, fenAfter: move.fenAfter, planned: move.uci, plannedSan: move.san,
        mover: me, evalAfter, gameKey: game.key, ply: move.ply,
      };
      if (isBlunder) {
        const reply = evalAfter.lines[0]?.pv[0];
        if (!reply || !playUci(move.fenAfter, reply)) continue;
        const note = blunderNote(move.fenAfter, reply, move.cpLoss, mateAgainstMover(evalAfter, me));
        seen.add(id);
        out.push({ ...base, blunder: true, reply, note });
      } else {
        if (evalAfter.terminal || legalCount(move.fenBefore) < 2) continue;
        seen.add(id);
        out.push({ ...base, blunder: false, reply: null, note: `The engine review rated ${move.san} as ${move.class} in your game.` });
      }
    }
  }
  return out;
}

/** Games can feed the drill when there are enough items and both kinds. */
export function gamesUsable(items: readonly CheckItem[]): boolean {
  const blunders = items.filter((i) => i.blunder).length;
  return items.length >= MIN_GAME_ITEMS && blunders >= MIN_GAME_KIND && items.length - blunders >= MIN_GAME_KIND;
}

/* ---------------------------------- items from puzzles ---------------------------------- */

/**
 * A Lichess puzzle's moves[0] is a real blunder by the side to move in puzzle.fen and moves[1] refutes it.
 * Both evaluations are White-POV engine results (evalBefore: puzzle.fen, evalAfterBlunder: the position after moves[0]).
 * Null when the puzzle cannot make the wanted kind of item.
 */
export function fromPuzzle(puzzle: Puzzle, evalBefore: PositionEval, evalAfterBlunder: PositionEval, wantBlunder: boolean, rand: Rng): CheckItem | null {
  if (!puzzle.opponentFirst || puzzle.moves.length < 2 || legalCount(puzzle.fen) < 2) return null;
  const best = evalBefore.lines[0];
  if (!best) return null;
  const mover = sideToMove(puzzle.fen);
  const blunderUci = puzzle.moves[0];
  const afterBlunder = playUci(puzzle.fen, blunderUci);
  if (!afterBlunder) return null;
  const lossCp = centipawnLoss(best.score, evalAfterBlunder.score, mover);
  if (lossCp < PUZZLE_BLUNDER_CP) return null;

  if (wantBlunder) {
    const reply = puzzle.moves[1];
    if (!playUci(afterBlunder.fen, reply)) return null;
    return {
      id: `p:${puzzle.id}:b`, source: 'puzzles', fen: puzzle.fen, fenAfter: afterBlunder.fen, planned: blunderUci, plannedSan: afterBlunder.move.san,
      mover, blunder: true, reply, evalAfter: evalAfterBlunder, puzzle,
      note: blunderNote(afterBlunder.fen, reply, lossCp, mateAgainstMover(evalAfterBlunder, mover)),
    };
  }

  const options = evalBefore.lines.filter((l) => {
    const uci = l.pv[0];
    return !!uci && uci !== blunderUci && centipawnLoss(best.score, l.score, mover) <= SAFE_WINDOW_CP;
  });
  if (!options.length) return null;
  const pick = options[Math.min(options.length - 1, Math.floor(rand() * options.length))];
  const planned = pick.pv[0];
  const played = playUci(puzzle.fen, planned);
  if (!played) return null;
  return {
    id: `p:${puzzle.id}:s`, source: 'puzzles', fen: puzzle.fen, fenAfter: played.fen, planned, plannedSan: played.move.san,
    mover, blunder: false, reply: null, puzzle,
    note: `The engine rates ${played.move.san} within half a pawn of the best move here.`,
  };
}

/* ---------------------------------- balance ---------------------------------- */

export function shuffle<T>(list: readonly T[], rand: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Longest run of one kind the deck serves. */
export const MAX_RUN = 3;

/** Yields true (blunder) or false (safe): a fair coin per draw, but never more than MAX_RUN of one kind in a row. */
export function makeAlternator(rand: Rng): () => boolean {
  let last: boolean | null = null;
  let run = 0;
  return () => {
    let kind = rand() < 0.5;
    if (run >= MAX_RUN && kind === last) kind = !kind;
    run = kind === last ? run + 1 : 1;
    last = kind;
    return kind;
  };
}

export interface Deck {
  next(): CheckItem | null;
}

class Pool {
  private order: CheckItem[];
  private at = 0;
  private last: CheckItem | null = null;
  constructor(private readonly items: readonly CheckItem[], private readonly rand: Rng) {
    this.order = shuffle(items, rand);
  }
  get size() {
    return this.items.length;
  }
  next(): CheckItem {
    if (this.at >= this.order.length) {
      this.order = shuffle(this.items, this.rand);
      // The first item of a new round is never the one that closed the last round.
      if (this.order.length > 1 && this.order[0] === this.last) [this.order[0], this.order[1]] = [this.order[1], this.order[0]];
      this.at = 0;
    }
    this.last = this.order[this.at++];
    return this.last;
  }
}

/**
 * A queue of items where blunder and safe items come in random order (about 50/50, at most MAX_RUN of a kind in a row), and an item comes back
 * only after every item of its kind was used. Items with the same id (the same ply of a game) count once.
 */
export function makeDeck(items: readonly CheckItem[], rand: Rng): Deck {
  const unique = [...new Map(items.map((i) => [i.id, i])).values()];
  const blunders = new Pool(unique.filter((i) => i.blunder), rand);
  const safes = new Pool(unique.filter((i) => !i.blunder), rand);
  const nextKind = makeAlternator(rand);
  return {
    next() {
      if (!blunders.size && !safes.size) return null;
      const wantBlunder = nextKind();
      const pool = wantBlunder ? (blunders.size ? blunders : safes) : safes.size ? safes : blunders;
      return pool.next();
    },
  };
}

/* ---------------------------------- verdicts ---------------------------------- */

/** What the player said. 'ask' = a real blunder was named, so the refutation is still to be found. */
export function decide(item: CheckItem, said: Said): Outcome | 'ask' {
  if (said === 'safe') return item.blunder ? 'missed' : 'correct';
  return item.blunder ? 'ask' : 'false-alarm';
}

function isMateMove(fen: string, uci: string): boolean {
  try {
    const chess = new Chess(fen);
    chess.move(uciToMove(uci));
    return chess.isCheckmate();
  } catch {
    return false;
  }
}

/** The player's try at the enemy's best reply. Any checkmate counts. */
export function judgeRefutation(item: CheckItem, uci: string): 'correct' | 'wrong-reason' {
  if (!item.blunder) return 'wrong-reason';
  if (item.reply && uci === item.reply) return 'correct';
  if (isMateMove(item.fenAfter, uci)) return 'correct';
  const opponent: Side = item.mover === 'w' ? 'b' : 'w';
  if (item.puzzle) {
    const v = judgePuzzleMove(item.puzzle, 1, item.fenAfter, uci);
    if (v === 'correct' || v === 'mate' || v === 'alt') return 'correct';
  }
  const v = judgeRetryMove(item.evalAfter, uci, opponent);
  return v === 'best' || v === 'good' ? 'correct' : 'wrong-reason';
}

/* ---------------------------------- daily totals ---------------------------------- */

export interface DayTotals {
  correct: number;
  wrongReason: number;
  missed: number;
  falseAlarms: number;
}

export interface BlunderTotals {
  days: Record<string, DayTotals>;
}

export const MAX_TOTAL_DAYS = 120;
const MAX_COUNT = 1_000_000;

export const EMPTY_TOTALS: BlunderTotals = { days: {} };

function count(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.min(MAX_COUNT, Math.floor(x)) : 0;
}

/** Keeps only well-formed days (real calendar dates, whole counts) and the newest MAX_TOTAL_DAYS of them. */
export function sanitizeTotals(raw: unknown): BlunderTotals {
  const days = raw && typeof raw === 'object' ? (raw as { days?: unknown }).days : null;
  if (!days || typeof days !== 'object' || Array.isArray(days)) return { days: {} };
  const keys = Object.keys(days).filter(isDateKey).sort().slice(-MAX_TOTAL_DAYS);
  const out: Record<string, DayTotals> = {};
  for (const k of keys) {
    const d = (days as Record<string, unknown>)[k];
    if (!d || typeof d !== 'object') continue;
    const r = d as Record<string, unknown>;
    out[k] = { correct: count(r.correct), wrongReason: count(r.wrongReason), missed: count(r.missed), falseAlarms: count(r.falseAlarms) };
  }
  return { days: out };
}

const FIELD: Record<Outcome, keyof DayTotals> = {
  correct: 'correct',
  'wrong-reason': 'wrongReason',
  missed: 'missed',
  'false-alarm': 'falseAlarms',
};

/** The totals with one more outcome on `dateKey`. Returns a new object. */
export function addOutcome(totals: BlunderTotals, dateKey: string, outcome: Outcome): BlunderTotals {
  if (!isDateKey(dateKey)) return sanitizeTotals(totals);
  const clean = sanitizeTotals(totals);
  const day = clean.days[dateKey] ?? { correct: 0, wrongReason: 0, missed: 0, falseAlarms: 0 };
  const field = FIELD[outcome];
  return sanitizeTotals({ days: { ...clean.days, [dateKey]: { ...day, [field]: day[field] + 1 } } });
}

/** Positions judged on one day. */
export function dayCount(totals: BlunderTotals, dateKey: string): number {
  const d = totals.days[dateKey];
  return d ? d.correct + d.wrongReason + d.missed + d.falseAlarms : 0;
}

/** Positions judged and how many were right, for one day. */
export function dayScore(totals: BlunderTotals, dateKey: string): { total: number; correct: number } {
  return { total: dayCount(totals, dateKey), correct: totals.days[dateKey]?.correct ?? 0 };
}

/** The last `n` days ending on `today`, oldest first. */
export function lastDays(totals: BlunderTotals, today: string, n: number): { date: string; total: number; correct: number }[] {
  const out: { date: string; total: number; correct: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({ date, ...dayScore(totals, date) });
  }
  return out;
}

/* ---------------------------------- session tally ---------------------------------- */

export interface Tally {
  played: number;
  correct: number;
  wrongReason: number;
  missed: number;
  falseAlarms: number;
}

export const EMPTY_TALLY: Tally = { played: 0, correct: 0, wrongReason: 0, missed: 0, falseAlarms: 0 };

export function addToTally(t: Tally, outcome: Outcome): Tally {
  const next = { ...t, played: t.played + 1 };
  next[FIELD[outcome]] += 1;
  return next;
}

/** Whole percent of positions judged right, or null before the first one. */
export function tallyPercent(t: Tally): number | null {
  return t.played ? Math.round((t.correct / t.played) * 100) : null;
}

/* ---------------------------------- full check ---------------------------------- */

export type EnteredResult = 'added' | 'repeat' | 'quiet' | 'illegal';

/** One move entered in a Full check: is it a new check or capture of the enemy? */
export function enterMove(fenAfter: string, entered: readonly string[], uci: string): EnteredResult {
  if (!isForcingMove(fenAfter, uci)) return playUci(fenAfter, uci) ? 'quiet' : 'illegal';
  return entered.includes(uci.slice(0, 4)) ? 'repeat' : 'added';
}

/** The checks and captures the player did not enter. */
export function missedForcing(fenAfter: string, entered: readonly string[]): ForcingMove[] {
  return enemyForcing(fenAfter).filter((m) => !entered.includes(m.from + m.to));
}

/** "You listed 2 of 5. Missed: Bg4+, Bg2+" for the small-screen dock: at most 4 moves, then "and n more". */
export function listedSummary(listed: number, total: number, missed: readonly ForcingMove[]): string {
  const head = `You listed ${listed} of ${total}.`;
  if (!missed.length) return head;
  const shown = missed.slice(0, 4).map((m) => m.san).join(', ');
  const more = missed.length > 4 ? ` and ${missed.length - 4} more` : '';
  return `${head} Missed: ${shown}${more}`;
}

function missedText(item: CheckItem): string {
  const forcing = item.reply ? isForcingMove(item.fenAfter, item.reply) : false;
  return forcing
    ? `${item.plannedSan} loses to a check or a capture you could have seen.`
    : `${item.plannedSan} allows a threat. Look at what they play next.`;
}

/** How the verdict reads, for the result panel. */
export function verdictText(outcome: Outcome, item: CheckItem): { title: string; text: string; good: boolean } {
  switch (outcome) {
    case 'correct':
      return item.blunder
        ? { title: 'Right, it was a blunder', text: `You saw why ${item.plannedSan} fails.`, good: true }
        : { title: 'Right, it was safe', text: `${item.plannedSan} holds up.`, good: true };
    case 'wrong-reason':
      return { title: 'It was a blunder, but not for that reason', text: `You felt the danger. The refutation was a different move.`, good: false };
    case 'missed':
      return { title: 'Missed it. This was a blunder', text: missedText(item), good: false };
    default:
      return { title: 'False alarm. This move was safe', text: `${item.plannedSan} holds up.`, good: false };
  }
}

/* ---------------------------------- remembered choice ---------------------------------- */

export interface Choice {
  source: CheckSource;
  mode: CheckMode;
}

export const DEFAULT_CHOICE: Choice = { source: 'puzzles', mode: 'quick' };

/** The stored choice from local storage text (old or damaged text gives the default). */
export function parseChoice(raw: string | null): Choice {
  if (!raw) return DEFAULT_CHOICE;
  try {
    const v = JSON.parse(raw) as { source?: unknown; mode?: unknown };
    return {
      source: v.source === 'games' ? 'games' : 'puzzles',
      mode: v.mode === 'full' ? 'full' : 'quick',
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}
