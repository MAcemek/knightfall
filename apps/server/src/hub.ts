import { FRIEND_MOVED_MESSAGE, isValidCode, normalizeCode, type ChallengeStatus, type ClientMessage, type PlayerInfo, type ServerMessage } from '@knightfall/core';
import { Bot, botInfoFor } from './bot.ts';
import { ChallengeBoard, CodeRegistry, type Challenge } from './challenges.ts';
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
  /** Sessions that said hello (they have a friend code and may send or receive challenges). */
  private readonly sessions = new Map<string, Session>();
  /** Sessions that ever said hello (kept after a takeover, so they can still be answered). Old clients never join. */
  private readonly helloed = new Set<string>();
  private readonly codes = new CodeRegistry();
  private readonly board = new ChallengeBoard();

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
      case 'hello': {
        const info = sanitizePlayer(msg.player);
        if (!info) return s.send({ type: 'error', message: 'Invalid player info' });
        s.info = info;
        const code = typeof msg.code === 'string' ? normalizeCode(msg.code) : undefined;
        const token = typeof msg.token === 'string' ? msg.token : undefined;
        const bound = this.codes.bind(s.id, code, token);
        if (bound.displaced) {
          // Another tab of the same browser took the code: tell the old one (a closed socket drops the message).
          const old = this.sessions.get(bound.displaced);
          this.dropSession(bound.displaced);
          old?.send({ type: 'error', message: FRIEND_MOVED_MESSAGE });
        }
        this.sessions.set(s.id, s);
        this.helloed.add(s.id);
        s.send({ type: 'welcome', code: bound.code, token: bound.token });
        this.log(`hello  ${info.name} (${info.rating}) code ${bound.code}`);
        break;
      }
      case 'challenge':
        this.challenge(s, msg.code);
        break;
      case 'challenge-cancel':
        this.cancelOutgoing(s);
        break;
      case 'challenge-respond':
        this.respond(s, msg.id, msg.accept === true);
        break;
      case 'queue': {
        const info = sanitizePlayer(msg.player);
        if (!info) return s.send({ type: 'error', message: 'Invalid player info' });
        const room = this.roomOf.get(s.id);
        if (room && !room.ended) return s.send({ type: 'error', message: 'Already in a battle' });
        this.cancelOutgoing(s);
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
      case 'claim':
        this.roomOf.get(s.id)?.claim(s.id);
        break;
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
    this.helloed.delete(s.id);
    if (!this.sessions.has(s.id)) return;
    this.dropSession(s.id);
    this.codes.unbind(s.id);
  }

  /**
   * Forget a session's friend state: withdraw the challenge it sent and drop the ones it received (their
   * senders get 'offline'). Used on disconnect and when a fast reconnect moves the code to a new session;
   * in that case the old session's pending challenges are withdrawn, not moved (simpler, and the clients
   * can just send again). After this the old session is unknown, so its later disconnect cannot unbind the code.
   */
  private dropSession(id: string) {
    const old = this.sessions.get(id);
    if (!old) return;
    const out = this.board.outgoing(id);
    if (out) {
      this.board.remove(out.id);
      this.withdraw(out);
      this.log(`invite ${old.info.name} left, withdrawn`);
    }
    for (const c of this.board.incoming(id)) {
      this.board.remove(c.id);
      this.sessions.get(c.from)?.send({ type: 'challenge-status', status: 'offline', name: old.info.name });
      this.log(`invite to ${old.info.name} dropped, offline`);
    }
    this.sessions.delete(id);
  }

  /** Periodic work: pair waiting players, give lonely ones a bot. */
  tick(now = Date.now()): void {
    this.matchPairs(now);
    for (const p of this.queue.takeStale(now)) this.startWithBot(p);
    this.codes.sweep();
    for (const c of this.board.takeExpired(now)) {
      this.withdraw(c, 'expired');
      this.log('invite expired');
    }
  }

  private isBusy(id: string): boolean {
    const room = this.roomOf.get(id);
    return !!room && !room.ended;
  }

  private status(s: Session, status: ChallengeStatus, name?: string) {
    s.send({ type: 'challenge-status', status, ...(name ? { name } : {}) });
  }

  /** The challenge is already removed from the board: take the card away from the target and tell the sender why. */
  private withdraw(c: Challenge, senderStatus?: ChallengeStatus) {
    const target = this.sessions.get(c.to);
    target?.send({ type: 'challenge-withdrawn', id: c.id });
    if (senderStatus) {
      const sender = this.sessions.get(c.from);
      if (sender) this.status(sender, senderStatus, target?.info.name);
    }
  }

  private cancelOutgoing(s: Session) {
    const out = this.board.outgoing(s.id);
    if (!out) return;
    this.board.remove(out.id);
    this.withdraw(out, 'cancelled');
    this.log(`invite ${s.info.name} cancelled`);
  }

  private challenge(s: Session, rawCode: unknown) {
    // Only sessions that said hello speak the friend protocol; old clients get nothing new. A session that
    // said hello but lost its code to another tab gets 'unavailable' instead of silence.
    if (!this.codes.codeOf(s.id)) {
      if (this.helloed.has(s.id)) this.status(s, 'unavailable');
      return;
    }
    const code = normalizeCode(typeof rawCode === 'string' ? rawCode : '');
    if (!isValidCode(code)) return this.status(s, 'invalid');
    if (code === this.codes.codeOf(s.id)) return this.status(s, 'self');
    if (!this.board.allow(s.id)) {
      this.log(`invite ${s.info.name} rate-limited`);
      return this.status(s, 'rate-limited');
    }
    if (!this.codes.knows(code)) return this.status(s, 'invalid');
    const targetId = this.codes.sessionOf(code);
    const target = targetId ? this.sessions.get(targetId) : undefined;
    if (!target) return this.status(s, 'offline');
    if (this.isBusy(s.id)) return this.status(s, 'unavailable');
    if (this.isBusy(target.id)) return this.status(s, 'busy', target.info.name);
    this.queue.remove(s.id);
    const { challenge, replaced, evicted } = this.board.create(s.id, target.id);
    if (replaced) this.withdraw(replaced);
    for (const old of evicted) this.withdraw(old, 'expired');
    const now = Date.now();
    s.send({ type: 'challenge-status', status: 'sent', name: target.info.name, expiresAt: challenge.expiresAt, serverNow: now });
    target.send({ type: 'challenge-received', id: challenge.id, from: { ...s.info }, expiresAt: challenge.expiresAt, serverNow: now });
    this.log(`invite ${s.info.name} -> ${target.info.name}`);
  }

  private respond(s: Session, id: unknown, accept: boolean) {
    const c = typeof id === 'string' ? this.board.get(id) : null;
    if (!c || c.to !== s.id) return;
    this.board.remove(c.id);
    if (c.expiresAt <= Date.now()) {
      this.withdraw(c, 'expired');
      this.log('invite expired');
      return;
    }
    const sender = this.sessions.get(c.from);
    if (!accept) {
      if (sender) this.status(sender, 'declined', s.info.name);
      this.log(`invite ${s.info.name} declined`);
      return;
    }
    if (!sender || this.isBusy(sender.id) || this.isBusy(s.id)) {
      this.status(s, 'unavailable', sender?.info.name);
      this.log(`invite ${s.info.name} accepted but unavailable`);
      return;
    }
    this.queue.remove(sender.id);
    this.queue.remove(s.id);
    this.detach(sender.id);
    this.detach(s.id);
    this.log(`invite ${s.info.name} accepted`);
    this.startRoom(sender, s, { friendly: true });
  }

  /** A human is about to enter a battle: drop the challenges they sent and decline the ones they received. */
  private clearChallengesFor(p: Participant) {
    if (!this.sessions.has(p.id)) return;
    const out = this.board.outgoing(p.id);
    if (out) {
      this.board.remove(out.id);
      this.withdraw(out);
    }
    for (const c of this.board.incoming(p.id)) {
      this.board.remove(c.id);
      this.sessions.get(c.from)?.send({ type: 'challenge-status', status: 'busy', name: p.info.name });
    }
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

  private startRoom(a: Participant, b: Participant, opts: { friendly?: boolean } = {}): Room {
    this.clearChallengesFor(a);
    this.clearChallengesFor(b);
    const room = new Room({
      id: newId('room'),
      seed: randomSeed(),
      players: [a, b],
      friendly: opts.friendly,
      onEnd: (r) => this.log(`end    ${r.id} ${r.endReason} ${r.scores[0].solved}-${r.scores[1].solved}`),
    });
    for (const p of room.players) {
      const prev = this.roomOf.get(p.id);
      if (prev) this.forget(prev);
      this.roomOf.set(p.id, room);
    }
    this.rooms.add(room);
    this.log(`match  ${a.info.name} (${a.info.rating}) vs ${b.info.name} (${b.info.rating})${room.friendly ? ' friendly' : ''}`);
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
      this.startRoom(a, b, { friendly: room.friendly });
    } else {
      opp.send({ type: 'rematch-offered' });
    }
  }
}
