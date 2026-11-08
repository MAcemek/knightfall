import type { Participant } from './participant.ts';

/** Rating gap allowed right away, how fast it grows while waiting, and its ceiling. */
export const BASE_GAP = 100;
export const GAP_PER_SECOND = 60;
export const MAX_GAP = 1000;
/** After this long alone in the queue, a player gets a sparring bot. */
export const BOT_AFTER_MS = 8000;

export interface QueueEntry {
  participant: Participant;
  rating: number;
  since: number;
}

export function allowedGap(waitedMs: number): number {
  return Math.min(MAX_GAP, BASE_GAP + (Math.max(0, waitedMs) / 1000) * GAP_PER_SECOND);
}

/**
 * Pick pairs from the queue: repeatedly take the closest-rated pair whose gap is within
 * the allowance of the longer-waiting player. Pure; returns pairs of entries.
 */
export function findPairs(entries: readonly QueueEntry[], now: number): [QueueEntry, QueueEntry][] {
  const pool = [...entries];
  const pairs: [QueueEntry, QueueEntry][] = [];
  for (;;) {
    let best: [number, number] | null = null;
    let bestGap = Infinity;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i];
        const b = pool[j];
        const gap = Math.abs(a.rating - b.rating);
        const allowance = allowedGap(now - Math.min(a.since, b.since));
        if (gap <= allowance && gap < bestGap) {
          bestGap = gap;
          best = [i, j];
        }
      }
    }
    if (!best) return pairs;
    const [i, j] = best;
    pairs.push([pool[i], pool[j]]);
    pool.splice(j, 1);
    pool.splice(i, 1);
  }
}

/** FIFO-ordered waiting list with rating-aware pairing. */
export class Matchmaker {
  private entries: QueueEntry[] = [];

  add(participant: Participant, now = Date.now()): number {
    this.remove(participant.id);
    this.entries.push({ participant, rating: participant.info.rating, since: now });
    return this.entries.length;
  }

  remove(id: string): boolean {
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.participant.id !== id);
    return this.entries.length !== n;
  }

  has(id: string): boolean {
    return this.entries.some((e) => e.participant.id === id);
  }

  position(id: string): number {
    return this.entries.findIndex((e) => e.participant.id === id) + 1;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Remove and return matched human pairs. */
  takePairs(now = Date.now()): [Participant, Participant][] {
    const pairs = findPairs(this.entries, now);
    for (const [a, b] of pairs) {
      this.remove(a.participant.id);
      this.remove(b.participant.id);
    }
    return pairs.map(([a, b]) => [a.participant, b.participant]);
  }

  /** Remove and return players who have waited too long and should face a bot. */
  takeStale(now = Date.now(), afterMs = BOT_AFTER_MS): Participant[] {
    const stale = this.entries.filter((e) => now - e.since >= afterMs);
    for (const e of stale) this.remove(e.participant.id);
    return stale.map((e) => e.participant);
  }
}
