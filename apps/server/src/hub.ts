import {
  BATTLE_RECONNECT_MS,
  DEFAULT_BATTLE_SETTINGS,
  FRIEND_MOVED_MESSAGE,
  isValidCode,
  normalizeCode,
  SERVER_CAPS,
  type BattleSettings,
  type ChallengeStatus,
  type ClientMessage,
  type PlayerInfo,
  type ServerMessage,
} from '@knightfall/core';
import { Bot, botInfoFor } from './bot.ts';
import { guard } from './guard.ts';
import { ChallengeBoard, CodeRegistry, type Challenge } from './challenges.ts';
import { ClubRegistry, type Club } from './club.ts';
import { Matchmaker } from './matchmaker.ts';
import { newId, sanitizePlayer, type Participant } from './participant.ts';
import { Room, type MatchedExtras } from './room.ts';
import { isDefaultSettings, resultFor, sanitizeSeries, sanitizeSettings } from './rules.ts';

/** A connected human. The transport (WebSocket) is hidden behind `send`. */
export class Session implements Participant {
  readonly id = newId('p');
  readonly isBot = false;
  info: PlayerInfo = { name: 'Anonymous', rating: 1200 };
  /** Capabilities announced in `hello` ('settings', 'club'). Old clients have none. */
  caps: ReadonlySet<string> = new Set();
  constructor(private readonly transport: (msg: ServerMessage) => void) {}
  send(msg: ServerMessage): void {
    this.transport(msg);
  }
}

const randomSeed = () => (Math.random() * 0x1_0000_0000) >>> 0;

/** Pause between the games of a best-of-3. */
export const SERIES_GAP_MS = 6000;

/** A friendly room's series: kept per room, rebuilt by every new game. Points are indexed like `room.players`. */
interface Series {
  length: 1 | 3;
  game: number;
  points: [number, number];
  settings: BattleSettings;
  /** Set while the next game of an undecided series is waiting to start. */
  timer: ReturnType<typeof setTimeout> | null;
}

/** A series is decided at 2 points, or when its last game is played. */
const seriesDecided = (st: Series) => Math.max(...st.points) >= 2 || st.game >= st.length;

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
  private readonly series = new Map<Room, Series>();
  private readonly clubs = new ClubRegistry();
  /** Sessions of club members, by id (a session replaced by another tab is not in `sessions`). */
  private readonly clubSessions = new Map<string, Session>();
  /** Seats held for players whose socket dropped mid-battle, by the id of the session that dropped. */
  private readonly holds = new Map<string, { code: string; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly log: (line: string) => void = () => {}) {}

  startTicking(intervalMs = 1000): void {
    this.tickTimer ??= setInterval(guard('tick', () => this.tick(), (line) => this.log(line)), intervalMs);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    for (const r of this.rooms) {
      r.dispose();
      r.players.forEach((p) => p instanceof Bot && p.stop());
    }
    this.rooms.clear();
    for (const h of this.holds.values()) clearTimeout(h.timer);
    this.holds.clear();
    for (const st of this.series.values()) if (st.timer) clearTimeout(st.timer);
    this.series.clear();
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
        s.caps = new Set(Array.isArray(msg.caps) ? msg.caps.filter((c): c is string => typeof c === 'string').slice(0, 16) : []);
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
        s.send({ type: 'welcome', code: bound.code, token: bound.token, caps: [...SERVER_CAPS] });
        this.log(`hello  ${info.name} (${info.rating}) code ${bound.code}`);
        if (typeof msg.resume === 'string' && s.caps.has('reconnect')) this.resume(s, msg.resume, bound.code, bound.displaced);
        break;
      }
      case 'challenge':
        this.challenge(s, msg);
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
        if (this.clubs.clubOf(s.id)) return s.send({ type: 'error', message: 'Leave the club room first' });
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
        if (this.holds.has(s.id)) break; // a late frame of a dropped socket: the held seat's score stays frozen
        if (this.clubs.clubOf(s.id)) {
          const r = this.clubs.progress(s.id, msg);
          if (r.ok) this.afterClub(r.club, r.phaseChanged);
        } else {
          this.roomOf.get(s.id)?.progress(s.id, msg);
        }
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
      case 'club-create':
        this.clubCreate(s, msg.settings);
        break;
      case 'club-join':
        this.clubJoin(s, msg.code);
        break;
      case 'club-leave':
        this.leaveClub(s.id);
        break;
      case 'club-start': {
        const r = this.clubs.start(s.id);
        if (!r.ok) return s.send({ type: 'club-error', reason: r.reason });
        this.log(`club   ${r.club.code} start (${r.club.racers.length} players)`);
        this.afterClub(r.club, true);
        break;
      }
      case 'club-new-race': {
        const r = this.clubs.newRace(s.id);
        if (!r.ok) return s.send({ type: 'club-error', reason: r.reason });
        this.log(`club   ${r.club.code} new race`);
        this.afterClub(r.club, true);
        break;
      }
      default:
        break;
    }
  }

  disconnect(s: Session): void {
    this.queue.remove(s.id);
    if (!this.holdSeat(s)) this.detach(s.id);
    this.clubSessions.delete(s.id);
    const dropped = this.clubs.disconnect(s.id);
    if (dropped) this.afterClub(dropped.club, dropped.phaseChanged);
    this.helloed.delete(s.id);
    if (!this.sessions.has(s.id)) return;
    this.dropSession(s.id);
    this.codes.unbind(s.id);
  }

  /**
   * A client that understands reconnecting lost its socket in the middle of a battle: keep its seat for
   * BATTLE_RECONNECT_MS (its clock runs on, its score stays) instead of giving the opponent the win at once.
   * Returns false when the seat is not held (old client, no friend code, no live battle): the caller leaves as before.
   */
  private holdSeat(s: Session): boolean {
    const room = this.roomOf.get(s.id);
    const code = this.codes.codeOf(s.id);
    if (!room || room.ended || !code || !s.caps.has('reconnect') || !this.sessions.has(s.id) || this.holds.has(s.id)) return false;
    const timer = setTimeout(
      guard('seat hold', () => {
        this.holds.delete(s.id);
        this.log(`away   ${s.info.name} did not come back`);
        this.detach(s.id);
      }, (line) => this.log(line)),
      BATTLE_RECONNECT_MS,
    );
    this.holds.set(s.id, { code, timer });
    this.tellOpponent(room, s.id, { type: 'opponent-away', graceMs: BATTLE_RECONNECT_MS });
    this.log(`away   ${s.info.name} dropped, seat held`);
    return true;
  }

  /** Only clients that announced 'reconnect' understand the away/back messages. */
  private tellOpponent(room: Room, id: string, msg: ServerMessage) {
    const opp = room.opponentOf(id);
    if (opp instanceof Session && opp.caps.has('reconnect')) opp.send(msg);
  }

  /**
   * A hello that names the room it wants back (`resume`): when that room still holds this friend code's seat (the
   * old socket is already closed, or still open and displaced by this one), move the seat to this session and send
   * it where the battle stands.
   */
  private resume(s: Session, roomId: string, code: string, displaced?: string) {
    const held = [...this.holds].find(([, h]) => h.code === code)?.[0];
    const oldId = [held, displaced].find((id) => id && this.roomOf.get(id)?.id === roomId);
    const room = oldId ? this.roomOf.get(oldId) : undefined;
    if (!oldId || !room || room.indexOf(oldId) === -1 || room.indexOf(s.id) !== -1) return;
    const hold = this.holds.get(oldId);
    if (hold) clearTimeout(hold.timer);
    this.holds.delete(oldId);
    room.replacePlayer(oldId, s);
    this.roomOf.delete(oldId);
    this.roomOf.set(s.id, room);
    this.log(`back   ${s.info.name} took the seat back`);
    this.tellOpponent(room, s.id, { type: 'opponent-back' });
    for (const m of room.resumeMessages(s.id)) s.send(m);
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
    // Each part on its own: one failing part must not stop the others from running this tick.
    const step = (label: string, fn: () => void) => guard(label, fn, (line) => this.log(line))();
    step('matchmaking', () => this.matchPairs(now));
    step('bots', () => {
      for (const p of this.queue.takeStale(now)) this.startWithBot(p);
    });
    step('codes', () => this.codes.sweep());
    step('clubs', () => this.tickClubs(now));
    step('invites', () => {
      for (const c of this.board.takeExpired(now)) {
        this.withdraw(c, 'expired');
        this.log('invite expired');
      }
    });
  }

  /** In a live battle, waiting for the next game of a series, or in a club room. */
  private isBusy(id: string): boolean {
    if (this.clubs.clubOf(id)) return true;
    const room = this.roomOf.get(id);
    return !!room && (!room.ended || !!this.series.get(room)?.timer);
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

  private challenge(s: Session, msg: Extract<ClientMessage, { type: 'challenge' }>) {
    const rawCode: unknown = msg.code;
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
    // Custom options only reach clients that understand them. Plain challenges work with everyone.
    const custom = msg.settings !== undefined || msg.series !== undefined;
    const options = custom ? { settings: sanitizeSettings(msg.settings), series: sanitizeSeries(msg.series) } : {};
    if (options.settings && (!isDefaultSettings(options.settings) || options.series === 3) && !target.caps.has('settings')) {
      return this.status(s, 'outdated', target.info.name);
    }
    this.queue.remove(s.id);
    const { challenge, replaced, evicted } = this.board.create(s.id, target.id, options);
    if (replaced) this.withdraw(replaced);
    for (const old of evicted) this.withdraw(old, 'expired');
    const now = Date.now();
    s.send({ type: 'challenge-status', status: 'sent', name: target.info.name, expiresAt: challenge.expiresAt, serverNow: now });
    const shown = target.caps.has('settings') ? options : {};
    target.send({ type: 'challenge-received', id: challenge.id, from: { ...s.info }, expiresAt: challenge.expiresAt, serverNow: now, ...shown });
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
    this.startRoom(sender, s, { friendly: true, settings: c.settings, series: c.series });
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

  /** Start a battle. Friendly rooms carry settings and a series (best of `series.length`), and tell each side the opponent code. */
  private startRoom(
    a: Participant,
    b: Participant,
    opts: { friendly?: boolean; settings?: BattleSettings; series?: 1 | 3 | Pick<Series, 'length' | 'game' | 'points'> } = {},
  ): Room {
    this.clearChallengesFor(a);
    this.clearChallengesFor(b);
    let st: Series | null = null;
    let extras: [MatchedExtras, MatchedExtras] | undefined;
    if (opts.friendly) {
      const given = typeof opts.series === 'object' ? opts.series : { length: opts.series ?? 1, game: 1, points: [0, 0] as [number, number] };
      const made: Series = { ...given, settings: opts.settings ?? DEFAULT_BATTLE_SETTINGS, timer: null };
      st = made;
      const extra = (opp: Participant, i: 0 | 1): MatchedExtras => {
        const oppCode = this.codes.codeOf(opp.id);
        return {
          ...(oppCode ? { opponentCode: oppCode } : {}),
          settings: { ...made.settings },
          series: { length: made.length, game: made.game, me: made.points[i], opp: made.points[1 - i] },
        };
      };
      extras = [extra(b, 0), extra(a, 1)];
    }
    const room = new Room({
      id: newId('room'),
      seed: randomSeed(),
      players: [a, b],
      friendly: opts.friendly,
      extras,
      durationMs: st?.settings.durationMs,
      onEnd: (r) => {
        this.log(`end    ${r.id} ${r.endReason} ${r.scores[0].solved}-${r.scores[1].solved}`);
        this.afterGame(r);
      },
    });
    for (const p of room.players) {
      const prev = this.roomOf.get(p.id);
      if (prev) this.forget(prev);
      this.roomOf.set(p.id, room);
    }
    this.rooms.add(room);
    if (st) this.series.set(room, st);
    this.log(`match  ${a.info.name} (${a.info.rating}) vs ${b.info.name} (${b.info.rating})${room.friendly ? ' friendly' : ''}${st && st.length === 3 ? ` series game ${st.game}` : ''}`);
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
    const st = this.series.get(room);
    if (st?.timer) clearTimeout(st.timer);
    this.series.delete(room);
    room.dispose();
    this.rooms.delete(room);
  }

  private rematch(p: Participant) {
    const room = this.roomOf.get(p.id);
    if (!room || !room.ended) return;
    // Between the games of a series the next game starts by itself.
    if (this.series.get(room)?.timer) return;
    const opp = room.opponentOf(p.id);
    if (!opp || !room.rematchOpen() || this.roomOf.get(opp.id) !== room) {
      p.send({ type: 'opponent-left' });
      return;
    }
    if (room.rematchVotes.has(p.id)) return;
    room.rematchVotes.add(p.id);
    if (room.rematchVotes.has(opp.id)) {
      const [a, b] = room.players.map((x) => (x instanceof Bot ? this.makeBot(x.info) : x));
      const old = this.series.get(room);
      for (const x of room.players) this.roomOf.delete(x.id);
      this.forget(room);
      // After a series, a rematch is a new series with the same settings.
      this.startRoom(a, b, { friendly: room.friendly, settings: old?.settings, series: old?.length });
    } else {
      opp.send({ type: 'rematch-offered' });
    }
  }

  /** A room's game ended: score it, and queue the next game of an undecided series. */
  private afterGame(room: Room) {
    const st = this.series.get(room);
    if (!st || st.length === 1 || room.endReason === 'opponent-left') return;
    const result = resultFor(room.scores[0], room.scores[1]);
    const [a, b] = st.points;
    st.points = [a + (result === 'win' ? 1 : result === 'draw' ? 0.5 : 0), b + (result === 'loss' ? 1 : result === 'draw' ? 0.5 : 0)];
    this.log(`series ${room.id} game ${st.game} ${result} -> ${st.points[0]}-${st.points[1]}`);
    if (seriesDecided(st)) {
      this.log(`series ${room.id} decided ${st.points[0]}-${st.points[1]}`);
      return;
    }
    st.timer = setTimeout(guard('series', () => this.nextGame(room), (line) => this.log(line)), SERIES_GAP_MS);
  }

  private nextGame(room: Room) {
    const st = this.series.get(room);
    if (!st) return;
    st.timer = null;
    // Someone left or started something else during the pause: the series is over.
    if (room.departed.size > 0 || !room.players.every((p) => this.roomOf.get(p.id) === room)) {
      this.log(`series ${room.id} abandoned`);
      return;
    }
    const [a, b] = room.players;
    this.startRoom(a, b, { friendly: true, settings: st.settings, series: { length: st.length, game: st.game + 1, points: st.points } });
  }

  /** Common checks before creating or joining a club: a session that said hello and is not in a battle. */
  private clubReady(s: Session): boolean {
    if (!this.helloed.has(s.id)) {
      s.send({ type: 'club-error', reason: 'Not connected yet' });
      return false;
    }
    const room = this.roomOf.get(s.id);
    if (room && !room.ended) {
      s.send({ type: 'club-error', reason: 'Finish your battle first' });
      return false;
    }
    this.queue.remove(s.id);
    this.cancelOutgoing(s);
    this.clearChallengesFor(s);
    this.detach(s.id);
    return true;
  }

  private clubCreate(s: Session, rawSettings: unknown) {
    if (!this.clubReady(s)) return;
    this.leaveClub(s.id);
    const club = this.clubs.create(this.clubJoiner(s), sanitizeSettings(rawSettings));
    this.clubSessions.set(s.id, s);
    this.log(`club   ${club.code} created by ${s.info.name}`);
    this.afterClub(club, true);
  }

  private clubJoin(s: Session, rawCode: unknown) {
    const here = this.clubs.clubOf(s.id);
    if (here && here.code === normalizeCode(typeof rawCode === 'string' ? rawCode : '')) return this.afterClub(here, true);
    if (!this.clubReady(s)) return;
    this.leaveClub(s.id);
    const r = this.clubs.join(rawCode, this.clubJoiner(s));
    if (!r.ok) return s.send({ type: 'club-error', reason: r.reason });
    this.clubSessions.set(s.id, s);
    if (r.replaced) this.clubSessions.delete(r.replaced);
    this.log(`club   ${r.club.code} ${s.info.name} ${r.replaced ? 'is back' : 'joined'} (${r.club.members.size})`);
    this.afterClub(r.club, true);
  }

  /** A club member is known by their friend code, so a player who rejoins on a new connection finds their seat. */
  private clubJoiner(s: Session) {
    const code = this.codes.codeOf(s.id);
    return { id: s.id, ...(code ? { code } : {}), ...s.info };
  }

  private leaveClub(id: string) {
    const r = this.clubs.leave(id);
    this.clubSessions.delete(id);
    if (!r) return;
    this.log(`club   ${r.club.code} ${r.closed ? 'closed (empty)' : 'member left'}`);
    if (!r.closed) this.afterClub(r.club, true);
  }

  /** Send the room state to its members (throttled unless forced). */
  private afterClub(club: Club, force: boolean) {
    const now = Date.now();
    if (!club.takeBroadcast(now, force)) return;
    if (force && club.phase === 'ended') this.log(`club   ${club.code} race ended`);
    for (const m of club.members.values()) if (m.connected) this.clubSessions.get(m.id)?.send(club.state(m.id, now));
  }

  private tickClubs(now: number) {
    const { changed, closed } = this.clubs.tick(now);
    for (const { club, memberIds } of closed) {
      this.log(`club   ${club.code} closed`);
      for (const id of memberIds) {
        this.clubSessions.get(id)?.send({ type: 'club-error', reason: 'Room closed' });
        this.clubSessions.delete(id);
      }
    }
    for (const club of this.clubs.all()) guard('club broadcast', () => this.afterClub(club, changed.includes(club)), (line) => this.log(line))();
  }
}
