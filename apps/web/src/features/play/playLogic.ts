/**
 * Bot games: the rules of one slow training game. No React, no storage, no clock of its own: every function
 * that needs the time takes `now` (ms).
 *
 * The state is plain data so it can be saved as it is. The position is never stored; it is rebuilt from the
 * moves with chess.js whenever it is needed.
 */
import { Chess, type Move } from 'chess.js';
import type { GameResult } from '@knightfall/core';
import type { GamePlayer, RatingLogRow, StoredGame } from '../../shared/db.ts';
import { BOT_MAX, BOT_MIN, clampElo } from '../../shared/engine/botEngine.ts';

export { BOT_MAX, BOT_MIN, clampElo };

export type Side = 'w' | 'b';
export type ColorChoice = 'w' | 'b' | 'random';
export type GameStatus = 'playing' | 'paused' | 'over';
export type GameReason = 'checkmate' | 'stalemate' | 'repetition' | 'fifty' | 'material' | 'time' | 'timeDraw' | 'resign';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface TimeControl {
  id: string;
  label: string;
  /** Start time per side, ms. */
  base: number;
  /** Added after every move, ms. */
  inc: number;
}

export const TIME_CONTROLS: readonly TimeControl[] = [
  { id: '15+10', label: '15 + 10', base: 900_000, inc: 10_000 },
  { id: '30+0', label: '30 + 0', base: 1_800_000, inc: 0 },
];

export interface BotMove {
  uci: string;
  san: string;
  /** The mover's clock after the move (increment included), ms. */
  clk: number;
}

export interface BotGame {
  id: string;
  startedAt: number;
  base: number;
  inc: number;
  you: Side;
  elo: number;
  moves: BotMove[];
  /** Both clocks as they were when `turnStartedAt` was set. */
  clocks: { w: number; b: number };
  /** When the side to move started thinking. Null while paused or over. */
  turnStartedAt: number | null;
  status: GameStatus;
  result: GameResult | null;
  reason: GameReason | null;
  /** shown: moves confirmed after the blunder check. changed: moves taken back. */
  checks: { shown: number; changed: number };
}

const MAX_PLIES = 800;

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w');

export function turnOf(g: Pick<BotGame, 'moves'>): Side {
  return g.moves.length % 2 === 0 ? 'w' : 'b';
}

export function botSide(g: Pick<BotGame, 'you'>): Side {
  return other(g.you);
}

/** Replay moves from the start position. Null when one of them is not legal. */
export function replay(moves: readonly { uci: string }[]): Chess | null {
  const chess = new Chess();
  for (const m of moves) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m.uci)) return null;
    try {
      chess.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
    } catch {
      return null;
    }
  }
  return chess;
}

export function currentFen(g: Pick<BotGame, 'moves'>): string {
  return (replay(g.moves) ?? new Chess()).fen();
}

export function lastMoveSquares(g: Pick<BotGame, 'moves'>): [string, string] | null {
  const m = g.moves[g.moves.length - 1];
  return m ? [m.uci.slice(0, 2), m.uci.slice(2, 4)] : null;
}

export interface StartOptions {
  id: string;
  now: number;
  base: number;
  inc: number;
  you: Side;
  elo: number;
}

/** A new game. It starts paused: the clocks begin with resume(), once the engine is ready. */
export function startGame(o: StartOptions): BotGame {
  return {
    id: o.id,
    startedAt: o.now,
    base: o.base,
    inc: o.inc,
    you: o.you,
    elo: o.elo,
    moves: [],
    clocks: { w: o.base, b: o.base },
    turnStartedAt: null,
    status: 'paused',
    result: null,
    reason: null,
    checks: { shown: 0, changed: 0 },
  };
}

/** The clock of `side` right now. */
export function clockNow(g: BotGame, side: Side, now: number): number {
  const running = g.status === 'playing' && g.turnStartedAt !== null && turnOf(g) === side;
  const spent = running ? Math.max(0, now - (g.turnStartedAt as number)) : 0;
  return Math.max(0, g.clocks[side] - spent);
}

/** The side whose time has run out, or null. */
export function flagged(g: BotGame, now: number): Side | null {
  if (g.status !== 'playing' || g.turnStartedAt === null) return null;
  const side = turnOf(g);
  return clockNow(g, side, now) <= 0 ? side : null;
}

export function pause(g: BotGame, now: number): BotGame {
  if (g.status !== 'playing') return g;
  const side = turnOf(g);
  return { ...g, clocks: { ...g.clocks, [side]: clockNow(g, side, now) }, turnStartedAt: null, status: 'paused' };
}

export function resume(g: BotGame, now: number): BotGame {
  if (g.status !== 'paused') return g;
  return { ...g, turnStartedAt: now, status: 'playing' };
}

/** The same game as it should be saved: paused, with the clock as it stands at `now`. */
export function toSaved(g: BotGame, now: number): BotGame {
  return g.status === 'playing' ? pause(g, now) : g;
}

export function recordCheck(g: BotGame, kind: 'shown' | 'changed'): BotGame {
  return { ...g, checks: { ...g.checks, [kind]: g.checks[kind] + 1 } };
}

/** What a position says about the end of the game, when it says anything. */
export function detectOutcome(chess: Chess): { result: GameResult; reason: GameReason } | null {
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'material' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'repetition' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'fifty' };
  return null;
}

/** True when `side` has more than a lone king, a king and one minor piece, or a king and two knights. */
export function canMate(chess: Chess, side: Side): boolean {
  let knights = 0;
  let bishops = 0;
  const bishopColors = new Set<number>();
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== side) continue;
      if (sq.type === 'p' || sq.type === 'q' || sq.type === 'r') return true;
      if (sq.type === 'n') knights++;
      if (sq.type === 'b') {
        bishops++;
        const file = sq.square.charCodeAt(0) - 97;
        const rank = Number(sq.square[1]) - 1;
        bishopColors.add((file + rank) % 2);
      }
    }
  }
  if (bishops === 0) return knights > 2;
  // Two bishops mate only on opposite colours.
  return bishopColors.size > 1 || knights > 0;
}

function finish(g: BotGame, result: GameResult, reason: GameReason, clocks: { w: number; b: number }): BotGame {
  return { ...g, clocks, turnStartedAt: null, status: 'over', result, reason };
}

/**
 * What running out of time means: the side whose time ran out loses, unless the other side (the one who would win) has only a
 * king, a king and one bishop, a king and one knight, a king and two knights, or a king and bishops that all stand on one
 * colour. Then it is a draw, whatever the flagging side has.
 */
export function flagOutcome(chess: Chess | null, loser: Side): { result: GameResult; reason: GameReason } {
  const winner = other(loser);
  if (chess && !canMate(chess, winner)) return { result: '1/2-1/2', reason: 'timeDraw' };
  return { result: winner === 'w' ? '1-0' : '0-1', reason: 'time' };
}

/** `side` ran out of time. The other clock stops where it was. */
export function timeOut(g: BotGame, side: Side): BotGame {
  if (g.status === 'over') return g;
  const o = flagOutcome(replay(g.moves), side);
  return finish(g, o.result, o.reason, { ...g.clocks, [side]: 0 });
}

export function resign(g: BotGame, now: number): BotGame {
  if (g.status === 'over') return g;
  const p = pause(g, now);
  return finish(g, g.you === 'w' ? '0-1' : '1-0', 'resign', p.clocks);
}

export type ApplyResult =
  | { kind: 'moved'; state: BotGame; move: Move }
  | { kind: 'flagged'; state: BotGame }
  | { kind: 'illegal'; state: BotGame };

/**
 * Play `uci` for the side to move at `now`. Adds the increment and passes the turn. When that side had
 * already run out of time the move is not played and the game ends on time. Nothing is played in a game that
 * is paused or over.
 */
export function applyMove(g: BotGame, uci: string, now: number): ApplyResult {
  if (g.status !== 'playing' || g.turnStartedAt === null) return { kind: 'illegal', state: g };
  const side = turnOf(g);
  const late = flagged(g, now);
  if (late) return { kind: 'flagged', state: timeOut(g, late) };
  if (g.moves.length >= MAX_PLIES) return { kind: 'illegal', state: g };
  const chess = replay(g.moves);
  if (!chess) return { kind: 'illegal', state: g };
  let move: Move;
  try {
    move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return { kind: 'illegal', state: g };
  }
  const clk = clockNow(g, side, now) + g.inc;
  const next: BotGame = {
    ...g,
    moves: [...g.moves, { uci: move.lan, san: move.san, clk }],
    clocks: { ...g.clocks, [side]: clk },
    turnStartedAt: now,
  };
  const outcome = detectOutcome(chess);
  return { kind: 'moved', state: outcome ? finish(next, outcome.result, outcome.reason, next.clocks) : next, move };
}

/** The position after `uci`, for showing a held move. Null when it is not legal. */
export function previewMove(g: BotGame, uci: string): { fen: string; move: Move } | null {
  const chess = replay(g.moves);
  if (!chess) return null;
  try {
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { fen: chess.fen(), move };
  } catch {
    return null;
  }
}

/** What the bot needs to know before it moves. */
export function botMoveContext(g: BotGame): { fen: string; legalMoves: number; ply: number; recapture: boolean } {
  const chess = replay(g.moves) ?? new Chess();
  const last = chess.history({ verbose: true }).pop();
  const recapture = !!last && !!last.captured && chess.moves({ verbose: true }).some((m) => !!m.captured && m.to === last.to);
  return { fen: chess.fen(), legalMoves: chess.moves().length, ply: g.moves.length, recapture };
}

/* ---------- thinking time ---------- */

export interface ThinkInput {
  clockMs: number;
  incMs: number;
  legalMoves: number;
  /** Half-moves played so far. */
  ply: number;
  recapture: boolean;
  /** A random number in [0, 1). */
  rand: number;
}

/** How long the bot should take over this move, ms. Believable rather than clever. */
export function thinkMs(i: ThinkInput): number {
  const r = Math.min(0.999999, Math.max(0, Number.isFinite(i.rand) ? i.rand : 0.5));
  const clock = Math.max(0, i.clockMs);
  let t: number;
  if (i.legalMoves <= 1) t = 800;
  else {
    if (i.ply < 8) t = 1500 + r * 2500;
    else t = Math.min(20_000, (clock / 40 + 0.6 * Math.max(0, i.incMs)) * (0.4 + r * 1.1));
    if (i.recapture) t /= 3;
  }
  t = Math.min(t, clock / 8);
  if (clock >= 3000) t = Math.max(t, 500);
  return Math.round(Math.max(0, t));
}

/* ---------- blunder check ---------- */

export const CHECK_ITEMS = [
  { id: 'checks', word: 'Checks', question: 'What checks do they have?', key: '1' },
  { id: 'captures', word: 'Captures', question: 'What can they take?', key: '2' },
  { id: 'threats', word: 'Threats', question: 'What do they threaten next?', key: '3' },
] as const;

export type CheckId = (typeof CHECK_ITEMS)[number]['id'];
export type Ticks = Record<CheckId, boolean>;

export const NO_TICKS: Ticks = { checks: false, captures: false, threats: false };

export function toggleTick(t: Ticks, id: CheckId): Ticks {
  return { ...t, [id]: !t[id] };
}

export function allTicked(t: Ticks): boolean {
  return CHECK_ITEMS.every((c) => t[c.id]);
}

/** "You changed your mind 2 times in 31 moves", or null before the first confirmed move. */
export function mindText(checks: { shown: number; changed: number }): string | null {
  if (checks.shown <= 0) return null;
  const times = checks.changed === 1 ? '1 time' : `${checks.changed} times`;
  const moves = checks.shown === 1 ? '1 move' : `${checks.shown} moves`;
  return `You changed your mind ${times} in ${moves}`;
}

/* ---------- clocks and words ---------- */

/** "14:59", "0:09.4" under ten seconds, "1:02:03" from an hour. */
export function formatClock(ms: number): string {
  const v = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (v < 10_000) {
    const tenths = Math.floor(v / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const s = Math.floor(v / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Your clock turns red below this. */
export const LOW_CLOCK_MS = 30_000;

export type Outcome = 'win' | 'loss' | 'draw';

export function outcomeFor(result: GameResult | null, you: Side): Outcome | null {
  if (result === '1/2-1/2') return 'draw';
  if (result === '1-0') return you === 'w' ? 'win' : 'loss';
  if (result === '0-1') return you === 'b' ? 'win' : 'loss';
  return null;
}

const REASON_WORDS: Record<GameReason, string> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  repetition: 'by threefold repetition',
  fifty: 'by the 50-move rule',
  material: 'because neither side can mate',
  time: 'on time',
  timeDraw: 'The time ran out, but the other side could not have mated',
  resign: 'by resignation',
};

/** "You won by checkmate", "Draw by stalemate", "You lost on time". */
export function resultText(g: Pick<BotGame, 'result' | 'reason' | 'you'>): string {
  const o = outcomeFor(g.result, g.you);
  if (!o || !g.reason) return 'The game is over';
  if (g.reason === 'timeDraw') return `Draw. ${REASON_WORDS.timeDraw}`;
  const head = o === 'win' ? 'You won' : o === 'loss' ? 'You lost' : 'Draw';
  return `${head} ${REASON_WORDS[g.reason]}`;
}

/** Moves in rows of "1. e4 e5" for the plain move list. */
export function moveRows(moves: readonly { san: string }[]): { n: number; w: string; b: string | null }[] {
  const rows: { n: number; w: string; b: string | null }[] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push({ n: i / 2 + 1, w: moves[i].san, b: moves[i + 1]?.san ?? null });
  return rows;
}

/* ---------- levels ---------- */

/** The rating of the newest rapid row in the rating log, or null. */
export function latestRapidRating(rows: readonly RatingLogRow[] | undefined): number | null {
  let best: RatingLogRow | null = null;
  for (const r of rows ?? []) {
    if (r.speed !== 'rapid' || !Number.isFinite(r.rating) || r.rating <= 0) continue;
    if (!best || r.date > best.date || (r.date === best.date && r.id > best.id)) best = r;
  }
  return best ? best.rating : null;
}

/** The level the slider starts on: your rapid rating rounded to ten, or 1500 when it is not known. */
export function defaultElo(rapid: number | null): number {
  if (rapid === null || !Number.isFinite(rapid) || rapid <= 0) return 1500;
  return clampElo(Math.round(rapid / 10) * 10);
}

/** Round a typed level to a step of ten inside the range. */
export function snapElo(elo: number): number {
  if (!Number.isFinite(elo)) return BOT_MIN;
  return Math.min(BOT_MAX, Math.max(BOT_MIN, Math.round(elo / 10) * 10));
}

export function levelLabel(elo: number): string {
  return `about ${elo}`;
}

export function resolveColor(choice: ColorChoice, rand: number): Side {
  return choice === 'random' ? (rand < 0.5 ? 'w' : 'b') : choice;
}

/* ---------- saving ---------- */

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isCount = (x: unknown): x is number => isNum(x) && x >= 0 && Number.isInteger(x);

/**
 * Read a saved game. Null unless everything in it is usable: the moves must be legal from the start position,
 * the numbers finite and the game not over. A game that was running comes back paused, with the clocks as
 * they were saved.
 */
export function sanitizeBotGame(raw: unknown): BotGame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
  if (!isNum(r.startedAt) || !isNum(r.base) || !isNum(r.inc) || !isNum(r.elo)) return null;
  if (r.base <= 0 || r.inc < 0 || r.base > 36_000_000 || r.inc > 3_600_000) return null;
  if (r.you !== 'w' && r.you !== 'b') return null;
  if (r.status === 'over' || r.result) return null;
  if (!Array.isArray(r.moves) || r.moves.length > MAX_PLIES) return null;
  const c = r.clocks as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== 'object' || !isNum(c.w) || !isNum(c.b) || c.w < 0 || c.b < 0) return null;
  const k = r.checks as Record<string, unknown> | null | undefined;
  if (!k || typeof k !== 'object' || !isCount(k.shown) || !isCount(k.changed)) return null;

  const uciList: { uci: string; clk: number }[] = [];
  for (const m of r.moves) {
    if (typeof m !== 'object' || m === null) return null;
    const mm = m as Record<string, unknown>;
    if (typeof mm.uci !== 'string' || !isNum(mm.clk) || mm.clk < 0) return null;
    uciList.push({ uci: mm.uci, clk: mm.clk });
  }
  const chess = new Chess();
  const moves: BotMove[] = [];
  for (const m of uciList) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m.uci)) return null;
    try {
      const mv = chess.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
      moves.push({ uci: mv.lan, san: mv.san, clk: m.clk });
    } catch {
      return null;
    }
  }
  if (detectOutcome(chess)) return null;
  return {
    id: r.id,
    startedAt: r.startedAt,
    base: r.base,
    inc: r.inc,
    you: r.you,
    elo: clampElo(r.elo),
    moves,
    clocks: { w: c.w, b: c.b },
    turnStartedAt: null,
    status: 'paused',
    result: null,
    reason: null,
    checks: { shown: k.shown, changed: k.changed },
  };
}

/* ---------- PGN and stored game ---------- */

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A [%clk] value: h:mm:ss with one decimal, rounded down. */
export function pgnClock(ms: number): string {
  const tenths = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 100);
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}.${tenths % 10}`;
}

/** A tag value that cannot break the header line. */
function tag(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').replace(/\\/g, '').replace(/"/g, "'").trim();
}

export function pgnDate(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
}

export function pgnTime(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export interface Names {
  w: string;
  b: string;
}

export function toPgn(g: BotGame, names: Names, ratings: { w?: number; b?: number }, result: GameResult, date: Date): string {
  const termination = g.reason === 'time' || g.reason === 'timeDraw' ? 'Time forfeit' : 'Normal';
  const headers: [string, string][] = [
    ['Event', 'Knightfall bot game'],
    ['Site', 'Knightfall'],
    ['Date', pgnDate(date)],
    ['UTCDate', pgnDate(date)],
    ['UTCTime', pgnTime(date)],
    ['White', tag(names.w)],
    ['Black', tag(names.b)],
    ['Result', result],
  ];
  if (ratings.w !== undefined) headers.push(['WhiteElo', String(Math.round(ratings.w))]);
  if (ratings.b !== undefined) headers.push(['BlackElo', String(Math.round(ratings.b))]);
  headers.push(['TimeControl', `${Math.round(g.base / 1000)}+${Math.round(g.inc / 1000)}`], ['Termination', termination]);
  const text: string[] = [];
  g.moves.forEach((m, i) => {
    const white = i % 2 === 0;
    // Black's first move after a comment needs its number written out ("1...").
    text.push(white ? `${i / 2 + 1}. ${m.san}` : `${Math.floor(i / 2) + 1}... ${m.san}`);
    text.push(`{ [%clk ${pgnClock(m.clk)}] }`);
  });
  text.push(result);
  return `${headers.map(([k, v]) => `[${k} "${v}"]`).join('\n')}\n\n${text.join(' ')}\n`;
}

export function botName(elo: number, playerName: string): string {
  const name = `Training bot (${levelLabel(elo)})`;
  return name.toLowerCase() === playerName.trim().toLowerCase() ? `${name} 2` : name;
}

/**
 * The finished game as a stored game, so it can be reviewed like any other. Null when it is not over or fewer
 * than two half-moves were played. `rating` is the player's rapid rating when known.
 */
export function toStoredGame(g: BotGame, playerName: string, rating: number | null, now: number): StoredGame | null {
  if (g.status !== 'over' || !g.result || g.moves.length < 2) return null;
  const me = tag(playerName).slice(0, 40) || 'You';
  const bot = botName(g.elo, me);
  const names: Names = g.you === 'w' ? { w: me, b: bot } : { w: bot, b: me };
  const known = typeof rating === 'number' && Number.isFinite(rating) && rating > 0 ? Math.round(rating) : undefined;
  const ratings = g.you === 'w' ? { w: known } : { b: known };
  const pgn = toPgn(g, names, ratings, g.result, new Date(g.startedAt));
  const mine: GamePlayer = { name: me, ...(known !== undefined ? { rating: known } : {}) };
  const theirs: GamePlayer = { name: bot };
  return {
    key: `bot-${g.id}`,
    source: 'bot',
    pgn,
    white: g.you === 'w' ? mine : theirs,
    black: g.you === 'w' ? theirs : mine,
    result: g.result,
    playedAt: g.startedAt,
    importedAt: now,
    plies: g.moves.length,
    speed: 'rapid',
    timeControl: `${Math.round(g.base / 1000)}+${Math.round(g.inc / 1000)}`,
    importedFor: me.toLowerCase(),
  };
}

/* ---------- past games ---------- */

export interface PastGameRow {
  key: string;
  outcome: Outcome | null;
  level: number | null;
  playedAt: number;
}

/** One line of the past-games list, from the player's point of view. `side` comes from userSide(). */
export function pastGameRow(game: Pick<StoredGame, 'key' | 'white' | 'black' | 'result' | 'playedAt'>, side: Side | null): PastGameRow {
  const botN = [game.white.name, game.black.name].find((n) => n.startsWith('Training bot')) ?? '';
  const m = /about (\d{3,4})/.exec(botN);
  return {
    key: game.key,
    outcome: side ? outcomeFor(game.result, side) : null,
    level: m ? Number(m[1]) : null,
    playedAt: game.playedAt,
  };
}
