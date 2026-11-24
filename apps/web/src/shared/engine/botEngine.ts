import { AbortError } from './pool.ts';
import { parseBestMove, type UciTransport } from './uci.ts';

/**
 * A Stockfish worker with limited strength, for playing against. It runs in its OWN worker and never in the
 * shared review pool: UCI_LimitStrength stays set for the life of a worker and would spoil game reviews.
 *
 * UciEngine keeps only the first principal variation of a search, which is the full-strength line. A weakened
 * engine picks its move at the very end, so the only trustworthy answer is the "bestmove" line, and that is
 * what this class returns.
 */

export const BOT_MIN = 1320;
export const BOT_MAX = 3190;

/** Keep a strength inside what the engine accepts. Anything that is not a number gives the lowest level. */
export function clampElo(elo: number): number {
  if (!Number.isFinite(elo)) return BOT_MIN;
  return Math.min(BOT_MAX, Math.max(BOT_MIN, Math.round(elo)));
}

const INIT_TIMEOUT_MS = 30_000;

export interface BotSearchOptions {
  moveTimeMs: number;
}

interface Pending {
  token: number;
  resolve: (uci: string) => void;
  reject: (e: Error) => void;
}

export class BotEngine {
  private readonly elo: number;
  private readyPromise: Promise<void> | null = null;
  private initReject: ((e: Error) => void) | null = null;
  private waiter: { token: string; resolve: () => void } | null = null;
  /** Bumped by every bestMove(), stop() and terminate(): an answer for an older number is never used. */
  private token = 0;
  private pending: Pending | null = null;
  /** "go" lines sent minus "bestmove" lines received. Answers arrive in order, so only the last one counts. */
  private outstanding = 0;
  private dead: Error | null = null;

  constructor(private readonly transport: UciTransport, elo: number) {
    this.elo = clampElo(elo);
    transport.onLine((line) => this.onLine(line));
    transport.onError((message) => this.fail(new Error(message)));
  }

  /** Handshake, strength options and a clean game. Safe to call more than once. */
  ready(): Promise<void> {
    this.readyPromise ??= this.handshake();
    return this.readyPromise;
  }

  private handshake(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.dead) {
        reject(this.dead);
        return;
      }
      const timer = setTimeout(() => this.fail(new Error('The engine did not start.')), INIT_TIMEOUT_MS);
      this.initReject = (e) => {
        clearTimeout(timer);
        reject(e);
      };
      void this.expect('uciok', 'uci')
        .then(() => {
          this.transport.post('setoption name UCI_LimitStrength value true');
          this.transport.post(`setoption name UCI_Elo value ${this.elo}`);
          this.transport.post('ucinewgame');
          return this.expect('readyok', 'isready');
        })
        .then(() => {
          clearTimeout(timer);
          this.initReject = null;
          resolve();
        });
    });
  }

  /**
   * The engine's move from the position after `ucis` were played from `startFen`.
   * Rejects with AbortError when stop() or a newer call came first; with any other error when the engine broke
   * or had no move.
   */
  async bestMove(startFen: string, ucis: readonly string[], opts: BotSearchOptions): Promise<string> {
    const token = ++this.token;
    this.supersede();
    await this.ready();
    if (this.dead) throw this.dead;
    if (token !== this.token) throw new AbortError();
    return new Promise<string>((resolve, reject) => {
      this.pending = { token, resolve, reject };
      this.outstanding++;
      this.transport.post(`position fen ${startFen}${ucis.length ? ` moves ${ucis.join(' ')}` : ''}`);
      this.transport.post(`go movetime ${Math.max(50, Math.round(opts.moveTimeMs))}`);
    });
  }

  /** Cancel the search. Its promise rejects with AbortError and the engine's late answer is thrown away. */
  stop(): void {
    this.token++;
    this.supersede();
    if (this.outstanding > 0) this.transport.post('stop');
  }

  terminate(): void {
    this.fail(new Error('Engine terminated'));
    this.transport.terminate();
  }

  private supersede(): void {
    const p = this.pending;
    this.pending = null;
    p?.reject(new AbortError());
  }

  private expect(token: string, command: string): Promise<void> {
    return new Promise((resolve) => {
      this.waiter = { token, resolve };
      this.transport.post(command);
    });
  }

  private fail(error: Error): void {
    if (this.dead) return;
    this.dead = error;
    this.token++;
    const p = this.pending;
    this.pending = null;
    p?.reject(error);
    this.initReject?.(error);
    this.initReject = null;
    // A ready() nobody started yet must still fail instead of waiting for a handshake that cannot come.
  }

  private onLine(line: string): void {
    const w = this.waiter;
    if (w && line.trim() === w.token) {
      this.waiter = null;
      w.resolve();
      return;
    }
    const move = parseBestMove(line);
    if (move === undefined) return;
    if (this.outstanding > 0) this.outstanding--;
    // An answer to a search that was stopped or replaced is not for the caller waiting now.
    if (this.outstanding > 0) return;
    const p = this.pending;
    if (!p || p.token !== this.token) return;
    this.pending = null;
    if (move === null) p.reject(new Error('The engine had no move to play.'));
    else p.resolve(move);
  }
}
