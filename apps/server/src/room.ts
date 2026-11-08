import { BATTLE_COUNTDOWN_MS, BATTLE_DURATION_MS, BATTLE_REMATCH_WINDOW_MS, type BattleScore } from '@knightfall/core';
import type { Participant } from './participant.ts';
import { acceptProgress, emptyScore, endReason, resultFor, type EndReason } from './rules.ts';

export const REMATCH_WINDOW_MS = BATTLE_REMATCH_WINDOW_MS;

export interface RoomOptions {
  id: string;
  seed: number;
  players: [Participant, Participant];
  /** Called once when the battle is over (after 'end' was sent). */
  onEnd?: (room: Room) => void;
  /** Override for tests. */
  countdownMs?: number;
  durationMs?: number;
}

/**
 * One battle between two participants. Owns the authoritative clock and scores.
 * Lifecycle: start() -> progress()* -> end (time / strikes / opponent-left).
 */
export class Room {
  readonly id: string;
  readonly seed: number;
  readonly players: [Participant, Participant];
  readonly scores: [BattleScore, BattleScore] = [emptyScore(), emptyScore()];
  startsAt = 0;
  endsAt = 0;
  ended = false;
  endedAt = 0;
  endReason: EndReason | null = null;
  /** Player ids who asked for a rematch after the end. */
  readonly rematchVotes = new Set<string>();
  /** Player ids who left the room (disconnect, leave, re-queue). */
  readonly departed = new Set<string>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onEnd?: (room: Room) => void;
  private readonly countdownMs: number;
  private readonly durationMs: number;

  constructor(o: RoomOptions) {
    this.id = o.id;
    this.seed = o.seed;
    this.players = o.players;
    this.onEnd = o.onEnd;
    this.countdownMs = o.countdownMs ?? BATTLE_COUNTDOWN_MS;
    this.durationMs = o.durationMs ?? BATTLE_DURATION_MS;
  }

  indexOf(id: string): 0 | 1 | -1 {
    return this.players[0].id === id ? 0 : this.players[1].id === id ? 1 : -1;
  }

  opponentOf(id: string): Participant | null {
    const i = this.indexOf(id);
    return i === -1 ? null : this.players[1 - i];
  }

  start(): void {
    const [a, b] = this.players;
    a.send({ type: 'matched', roomId: this.id, seed: this.seed, opponent: { ...b.info } });
    b.send({ type: 'matched', roomId: this.id, seed: this.seed, opponent: { ...a.info } });
    const now = Date.now();
    this.startsAt = now + this.countdownMs;
    this.endsAt = this.startsAt + this.durationMs;
    for (const p of this.players) p.send({ type: 'start', startsAt: this.startsAt, endsAt: this.endsAt, serverNow: now });
    this.timer = setTimeout(() => this.finish('time'), this.endsAt - now);
  }

  /** A progress report from a player. Returns true when it was accepted. */
  progress(playerId: string, report: { index: unknown; solved: unknown; strikes: unknown }): boolean {
    if (this.ended) return false;
    const i = this.indexOf(playerId);
    if (i === -1) return false;
    const now = Date.now();
    const next = acceptProgress(this.scores[i], report, now, this.startsAt);
    if (!next) return false;
    const changed = next.solved !== this.scores[i].solved || next.strikes !== this.scores[i].strikes;
    this.scores[i] = next;
    if (changed) {
      this.players[1 - i].send({ type: 'opponent-progress', solved: next.solved, strikes: next.strikes, index: report.index as number });
    }
    const reason = endReason(this.scores[0], this.scores[1], now, this.endsAt);
    if (reason) this.finish(reason);
    return true;
  }

  /** A player left mid-game: the other one wins. After the end it only marks them as departed. */
  leave(playerId: string): void {
    const i = this.indexOf(playerId);
    if (i === -1) return;
    this.departed.add(playerId);
    if (this.ended) return;
    this.finish('opponent-left', i);
  }

  /** Remaining time in the rematch window (0 when closed). */
  rematchOpen(now = Date.now()): boolean {
    return this.ended && now - this.endedAt <= REMATCH_WINDOW_MS && this.departed.size === 0;
  }

  /** Force-stop timers (server shutdown). */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private finish(reason: EndReason, leaverIndex = -1): void {
    if (this.ended) return;
    this.ended = true;
    this.endedAt = Date.now();
    this.endReason = reason;
    this.dispose();
    this.players.forEach((p, i) => {
      if (i === leaverIndex) return;
      const you = { ...this.scores[i] };
      const opponent = { ...this.scores[1 - i] };
      const result = leaverIndex !== -1 ? 'win' : resultFor(you, opponent);
      p.send({ type: 'end', result, reason, you, opponent });
    });
    this.onEnd?.(this);
  }
}
