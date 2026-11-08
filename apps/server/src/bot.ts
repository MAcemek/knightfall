import { BATTLE_MAX_STRIKES, BATTLE_RAMP, rampRating, type PlayerInfo, type ServerMessage } from '@knightfall/core';
import { newId, type Participant } from './participant.ts';

const TIERS: { max: number; name: string }[] = [
  { max: 900, name: 'Bot · Rookie' },
  { max: 1300, name: 'Bot · Sparring' },
  { max: 1700, name: 'Bot · Tactician' },
  { max: 2100, name: 'Bot · Sharpshooter' },
  { max: Infinity, name: 'Bot · Grandmaster' },
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function botInfoFor(playerRating: number, rand: () => number = Math.random): PlayerInfo {
  const rating = Math.round(clamp(playerRating + (rand() * 2 - 1) * 60, 400, 3000));
  const name = TIERS.find((t) => rating <= t.max)!.name;
  return { name, rating };
}

/** Milliseconds a bot of `rating` spends on one puzzle: 11s for weak bots down to 4s for strong ones, with jitter. */
export function botThinkMs(rating: number, rand: () => number = Math.random): number {
  const t = clamp((rating - 600) / 1800, 0, 1);
  const base = 10_000 - t * 5_000; // 10s .. 5s
  return Math.round(clamp(base + (rand() * 2 - 1) * 1_000, 4_000, 11_000));
}

/** Chance that a bot of `rating` solves the i-th battle puzzle (decreases with index). */
export function botSolveChance(rating: number, index: number): number {
  const puzzle = rampRating(index, BATTLE_RAMP.start, BATTLE_RAMP.step);
  const p = 1 / (1 + Math.pow(10, (puzzle - rating) / 450)) + 0.06;
  return clamp(p, 0.08, 0.97);
}

/**
 * Server-side sparring partner. Behaves like a client: waits for 'start', then reports
 * a solve or a strike every few seconds until it is out of strikes or the battle ends.
 * It always accepts a rematch after a short "thinking" pause.
 */
export class Bot implements Participant {
  readonly id = newId('bot');
  readonly isBot = true;
  info: PlayerInfo;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private solved = 0;
  private strikes = 0;
  private index = 0;
  private active = false;

  constructor(
    info: PlayerInfo,
    private readonly hooks: {
      progress: (bot: Bot, report: { index: number; solved: number; strikes: number }) => void;
      rematch: (bot: Bot) => void;
    },
    private readonly rand: () => number = Math.random,
  ) {
    this.info = info;
  }

  send(msg: ServerMessage): void {
    switch (msg.type) {
      case 'start': {
        this.stop();
        this.active = true;
        this.solved = this.strikes = this.index = 0;
        const firstIn = Math.max(0, msg.startsAt - msg.serverNow);
        this.later(() => this.step(), firstIn + botThinkMs(this.info.rating, this.rand));
        break;
      }
      case 'end':
        this.stop();
        break;
      case 'rematch-offered':
        this.later(() => this.hooks.rematch(this), 900 + this.rand() * 1400);
        break;
      default:
        break;
    }
  }

  stop(): void {
    this.active = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(setTimeout(fn, ms));
  }

  private step() {
    if (!this.active) return;
    if (this.rand() < botSolveChance(this.info.rating, this.index)) this.solved++;
    else this.strikes++;
    const report = { index: this.index, solved: this.solved, strikes: this.strikes };
    this.index++;
    this.hooks.progress(this, report);
    if (this.active && this.strikes < BATTLE_MAX_STRIKES) this.later(() => this.step(), botThinkMs(this.info.rating, this.rand));
  }
}
