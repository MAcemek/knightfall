import type { ClientMessage, PlayerInfo, ServerMessage } from '@knightfall/core';
import { Bot, botInfoFor } from './bot.ts';
import { Matchmaker } from './matchmaker.ts';
import { newId, sanitizePlayer, type Participant } from './participant.ts';
import { Room } from './room.ts';

/** A connected human. The transport (WebSocket) is hidden behind `send`. */
export class Session implements Participant {
  readonly id = newId('p');
  readonly isBot = false;
  info: PlayerInfo = { name: 'Anonymous', rating: 1200 };
  constructor(private readonly transport: (msg: ServerMessage) => void) {}
  send(msg: ServerMessage): void {
    this.transport(msg);
  }
}

const randomSeed = () => (Math.random() * 0x1_0000_0000) >>> 0;

/**
 * Coordinates sessions, the matchmaking queue, rooms, bots and rematches.
 * Transport-agnostic so it can be driven by tests as well as by the ws server.
 */
export class BattleHub {
  private readonly queue = new Matchmaker();
  /** Current or most recent room of each participant (humans and bots). */
  private readonly roomOf = new Map<string, Room>();
  private readonly rooms = new Set<Room>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly log: (line: string) => void = () => {}) {}

  startTicking(intervalMs = 1000): void {
    this.tickTimer ??= setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    for (const r of this.rooms) {
      r.dispose();
      r.players.forEach((p) => p instanceof Bot && p.stop());
    }
    this.rooms.clear();
  }

  get stats() {
    return { queued: this.queue.size, rooms: [...this.rooms].filter((r) => !r.ended).length };
  }

  /** Handle one decoded client message. Unknown/malformed messages are ignored. */
  handle(s: Session, msg: ClientMessage): void {
    switch (msg.type) {
      case 'ping':
        s.send({ type: 'pong', serverNow: Date.now() });
        break;
      case 'queue': {
        const info = sanitizePlayer(msg.player);
        if (!info) return s.send({ type: 'error', message: 'Invalid player info' });
        const room = this.roomOf.get(s.id);
        if (room && !room.ended) return s.send({ type: 'error', message: 'Already in a battle' });
        this.detach(s.id);
        s.info = info;
        this.queue.add(s);
        s.send({ type: 'queued', position: this.queue.position(s.id) });
        this.log(`queue  ${info.name} (${info.rating}) — ${this.queue.size} waiting`);
        this.matchPairs();
        break;
      }
      case 'cancel':
        this.queue.remove(s.id);
        break;
      case 'progress': {
        const room = this.roomOf.get(s.id);
        room?.progress(s.id, msg);
        break;
      }
      case 'rematch':
        this.rematch(s);
        break;
      case 'leave':
        this.queue.remove(s.id);
        this.detach(s.id);
        break;
      default:
        break;
    }
  }

  disconnect(s: Session): void {
    this.queue.remove(s.id);
    this.detach(s.id);
  }

  /** Periodic work: pair waiting players, give lonely ones a bot. */
  tick(now = Date.now()): void {
    this.matchPairs(now);
    for (const p of this.queue.takeStale(now)) this.startWithBot(p);
  }

  private matchPairs(now = Date.now()) {
    for (const [a, b] of this.queue.takePairs(now)) this.startRoom(a, b);
  }

  private makeBot(info: PlayerInfo): Bot {
    return new Bot(info, {
      progress: (bot, report) => this.roomOf.get(bot.id)?.progress(bot.id, report),
      rematch: (bot) => this.rematch(bot),
    });
  }

  private startWithBot(p: Participant) {
    this.startRoom(p, this.makeBot(botInfoFor(p.info.rating)));
  }

  private startRoom(a: Participant, b: Participant): Room {
    const room = new Room({
      id: newId('room'),
      seed: randomSeed(),
      players: [a, b],
      onEnd: (r) => this.log(`end    ${r.id} ${r.endReason} ${r.scores[0].solved}-${r.scores[1].solved}`),
    });
    for (const p of room.players) {
      const prev = this.roomOf.get(p.id);
      if (prev) this.forget(prev);
      this.roomOf.set(p.id, room);
    }
    this.rooms.add(room);
    this.log(`match  ${a.info.name} (${a.info.rating}) vs ${b.info.name} (${b.info.rating})`);
    room.start();
    return room;
  }

  /** Detach a participant from its current/last room (leave mid-game, or leave the post-game screen). */
  private detach(id: string) {
    const room = this.roomOf.get(id);
    if (!room) return;
    this.roomOf.delete(id);
    const wasOpenForRematch = room.ended && room.departed.size === 0;
    room.leave(id);
    const opp = room.opponentOf(id);
    if (opp) {
      if (wasOpenForRematch && this.roomOf.get(opp.id) === room) opp.send({ type: 'opponent-left' });
      if (opp instanceof Bot) {
        opp.stop();
        this.roomOf.delete(opp.id);
      }
    }
    if (room.players.every((p) => this.roomOf.get(p.id) !== room)) this.forget(room);
  }

  private forget(room: Room) {
    room.dispose();
    this.rooms.delete(room);
  }

  private rematch(p: Participant) {
    const room = this.roomOf.get(p.id);
    if (!room || !room.ended) return;
    const opp = room.opponentOf(p.id);
    if (!opp || !room.rematchOpen() || this.roomOf.get(opp.id) !== room) {
      p.send({ type: 'opponent-left' });
      return;
    }
    if (room.rematchVotes.has(p.id)) return;
    room.rematchVotes.add(p.id);
    if (room.rematchVotes.has(opp.id)) {
      const [a, b] = room.players.map((x) => (x instanceof Bot ? this.makeBot(x.info) : x));
      for (const x of room.players) this.roomOf.delete(x.id);
      this.forget(room);
      this.startRoom(a, b);
    } else {
      opp.send({ type: 'rematch-offered' });
    }
  }
}
