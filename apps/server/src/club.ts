import {
  BATTLE_COUNTDOWN_MS,
  CLUB_IDLE_MS,
  CLUB_MAX_PLAYERS,
  isValidCode,
  normalizeCode,
  type BattleSettings,
  type ClubPhase,
  type ClubPlayer,
  type ServerMessage,
} from '@knightfall/core';
import { randomCode } from './challenges.ts';
import { acceptProgress, isOut } from './rules.ts';

/** A disconnected member is removed after this long. */
export const CLUB_DISCONNECT_MS = 60_000;
/** A room sends at most one non-forced `club-state` per this many ms (4 a second). */
export const CLUB_BROADCAST_MS = 250;

export type ClubStateMessage = Extract<ServerMessage, { type: 'club-state' }>;

export interface ClubMember {
  id: string;
  name: string;
  rating: number;
  solved: number;
  strikes: number;
  connected: boolean;
  disconnectedAt: number;
  /** When the current `solved` count was reached (null until the first solve). Breaks ties in the ranking. */
  reachedAt: number | null;
  /** Joined during a race: not ranked until the next race. */
  spectator: boolean;
}

/** Most solved, then fewer strikes, then whoever reached that score first. Stable for full ties. */
export function rankMembers<T extends Pick<ClubMember, 'solved' | 'strikes' | 'reachedAt'>>(list: readonly T[]): T[] {
  const at = (m: T) => m.reachedAt ?? Infinity;
  return [...list].sort((a, b) => {
    if (a.solved !== b.solved) return b.solved - a.solved;
    if (a.strikes !== b.strikes) return a.strikes - b.strikes;
    if (at(a) === at(b)) return 0;
    return at(a) < at(b) ? -1 : 1;
  });
}

/** One club room: a lobby, then one simultaneous race at a time. Pure state; the registry and hub drive it. */
export class Club {
  phase: ClubPhase = 'lobby';
  seed?: number;
  startsAt?: number;
  endsAt?: number;
  hostId: string;
  readonly members = new Map<string, ClubMember>();
  lastActivity: number;
  private lastBroadcast = -Infinity;
  private dirty = true;

  constructor(
    readonly code: string,
    readonly settings: BattleSettings,
    host: { id: string; name: string; rating: number },
    now: number,
  ) {
    this.hostId = host.id;
    this.lastActivity = now;
    this.addMember(host, false);
  }

  addMember(p: { id: string; name: string; rating: number }, spectator: boolean): void {
    this.members.set(p.id, { ...p, solved: 0, strikes: 0, connected: true, disconnectedAt: 0, reachedAt: null, spectator });
    this.touch();
  }

  removeMember(id: string): void {
    this.members.delete(id);
    this.reassignHost();
    this.touch();
  }

  /**
   * When the host left or lost their connection, hand the room to the earliest connected racer (else the earliest
   * connected spectator, else the earliest member). A dropped host comes back as a new member, so waiting is useless.
   */
  reassignHost(): void {
    const host = this.members.get(this.hostId);
    if (host?.connected) return;
    const all = [...this.members.values()];
    const next = all.find((m) => m.connected && !m.spectator) ?? all.find((m) => m.connected) ?? (host ? undefined : all[0]);
    if (next) this.hostId = next.id;
  }

  /** The racers (not spectators), in join order. */
  get racers(): ClubMember[] {
    return [...this.members.values()].filter((m) => !m.spectator);
  }

  touch(): void {
    this.dirty = true;
  }

  /** Move the phase on with the clock. Returns true when it changed. */
  advance(now: number): boolean {
    let changed = false;
    if (this.phase === 'countdown' && now >= this.startsAt!) {
      this.phase = 'playing';
      changed = true;
    }
    if (this.phase === 'playing' && now >= this.endsAt!) {
      this.phase = 'ended';
      changed = true;
    }
    if (this.endIfDone()) changed = true;
    if (changed) this.touch();
    return changed;
  }

  /** End the race early when every racer has struck out or is gone. */
  endIfDone(): boolean {
    if (this.phase !== 'playing') return false;
    if (!this.racers.every((m) => isOut(m) || !m.connected)) return false;
    this.phase = 'ended';
    this.touch();
    return true;
  }

  /** The players in display order: join order before the race, the live ranking during and after it. */
  players(): ClubPlayer[] {
    const ranked = this.phase === 'playing' || this.phase === 'ended';
    const list = ranked ? rankMembers(this.racers) : this.racers;
    return list.map((m, i) => ({
      id: m.id,
      name: m.name,
      rating: m.rating,
      solved: m.solved,
      strikes: m.strikes,
      out: isOut(m),
      connected: m.connected,
      ...(this.phase === 'ended' ? { place: i + 1 } : {}),
    }));
  }

  /** The `club-state` message for one member. Spectators are not in `players`. */
  state(you: string, now: number): ClubStateMessage {
    const race = this.phase === 'lobby' ? {} : { seed: this.seed, startsAt: this.startsAt, endsAt: this.endsAt };
    return {
      type: 'club-state',
      code: this.code,
      you,
      hostId: this.hostId,
      phase: this.phase,
      players: this.players(),
      settings: { ...this.settings },
      ...race,
      serverNow: now,
    };
  }

  /** True when a `club-state` may go out now (and records it). Forced sends skip the throttle. */
  takeBroadcast(now: number, force: boolean): boolean {
    if (!force && (!this.dirty || now - this.lastBroadcast < CLUB_BROADCAST_MS)) return false;
    this.lastBroadcast = now;
    this.dirty = false;
    return true;
  }
}

export type ClubResult = { ok: true; club: Club; phaseChanged: boolean } | { ok: false; reason: string };

export interface ClubRegistryOptions {
  now?: () => number;
  genCode?: () => string;
  genSeed?: () => number;
  countdownMs?: number;
  idleMs?: number;
  disconnectMs?: number;
  maxPlayers?: number;
}

const randomSeed = () => (Math.random() * 0x1_0000_0000) >>> 0;

/** All club rooms. Codes live in their own map, apart from friend codes. */
export class ClubRegistry {
  private readonly clubs = new Map<string, Club>();
  private readonly byMember = new Map<string, string>();
  private readonly now: () => number;
  private readonly genCode: () => string;
  private readonly genSeed: () => number;
  private readonly countdownMs: number;
  private readonly idleMs: number;
  private readonly disconnectMs: number;
  private readonly maxPlayers: number;

  constructor(o: ClubRegistryOptions = {}) {
    this.now = o.now ?? Date.now;
    this.genCode = o.genCode ?? randomCode;
    this.genSeed = o.genSeed ?? randomSeed;
    this.countdownMs = o.countdownMs ?? BATTLE_COUNTDOWN_MS;
    this.idleMs = o.idleMs ?? CLUB_IDLE_MS;
    this.disconnectMs = o.disconnectMs ?? CLUB_DISCONNECT_MS;
    this.maxPlayers = o.maxPlayers ?? CLUB_MAX_PLAYERS;
  }

  get size(): number {
    return this.clubs.size;
  }

  all(): Club[] {
    return [...this.clubs.values()];
  }

  get(code: string): Club | null {
    return this.clubs.get(code) ?? null;
  }

  clubOf(id: string): Club | null {
    const code = this.byMember.get(id);
    return code ? (this.clubs.get(code) ?? null) : null;
  }

  /** Open a room with `host` in it. The caller leaves the host's previous club first. */
  create(host: { id: string; name: string; rating: number }, settings: BattleSettings): Club {
    let code = this.genCode();
    while (this.clubs.has(code)) code = this.genCode();
    const club = new Club(code, settings, host, this.now());
    this.clubs.set(code, club);
    this.byMember.set(host.id, code);
    return club;
  }

  /** Join by code. During a race the newcomer waits as a spectator for the next one. The caller leaves the previous club first. */
  join(rawCode: unknown, p: { id: string; name: string; rating: number }): ClubResult {
    const code = normalizeCode(typeof rawCode === 'string' ? rawCode : '');
    const club = isValidCode(code) ? this.clubs.get(code) : undefined;
    if (!club) return { ok: false, reason: 'Room not found' };
    if (club.members.has(p.id)) return { ok: true, club, phaseChanged: false };
    const now = this.now();
    const phaseChanged = club.advance(now);
    if (club.members.size >= this.maxPlayers) return { ok: false, reason: 'Room is full' };
    club.addMember(p, club.phase !== 'lobby');
    club.lastActivity = now;
    this.byMember.set(p.id, code);
    return { ok: true, club, phaseChanged };
  }

  /** Remove a member. Returns the club they were in, and whether it closed because it is now empty. */
  leave(id: string): { club: Club; closed: boolean; phaseChanged: boolean } | null {
    const club = this.clubOf(id);
    if (!club) return null;
    const now = this.now();
    this.byMember.delete(id);
    club.removeMember(id);
    club.lastActivity = now;
    if (club.members.size === 0) {
      this.clubs.delete(club.code);
      return { club, closed: true, phaseChanged: false };
    }
    return { club, closed: false, phaseChanged: club.endIfDone() };
  }

  /** Host starts the race: countdown, then play until `endsAt`. */
  start(id: string): ClubResult {
    const found = this.hostClub(id);
    if (!found.ok) return found;
    const club = found.club;
    if (club.phase !== 'lobby') return { ok: false, reason: 'A race is already running' };
    const now = this.now();
    club.seed = this.genSeed();
    club.startsAt = now + this.countdownMs;
    club.endsAt = club.startsAt + club.settings.durationMs;
    club.phase = 'countdown';
    club.lastActivity = now;
    club.touch();
    return { ok: true, club, phaseChanged: true };
  }

  /** Host sends everyone back to the lobby with scores reset (spectators become racers). */
  newRace(id: string): ClubResult {
    const found = this.hostClub(id);
    if (!found.ok) return found;
    const club = found.club;
    club.advance(this.now());
    if (club.phase !== 'ended') return { ok: false, reason: 'The race is not over yet' };
    for (const m of club.members.values()) Object.assign(m, { solved: 0, strikes: 0, reachedAt: null, spectator: false });
    club.phase = 'lobby';
    club.seed = club.startsAt = club.endsAt = undefined;
    club.lastActivity = this.now();
    club.touch();
    return { ok: true, club, phaseChanged: true };
  }

  /** A progress report. Uses the same acceptance rules as 1v1 rooms. */
  progress(id: string, report: { index: unknown; solved: unknown; strikes: unknown }): ClubResult {
    const club = this.clubOf(id);
    if (!club) return { ok: false, reason: 'Not in a club' };
    const now = this.now();
    let phaseChanged = club.advance(now);
    const m = club.members.get(id)!;
    if (club.phase !== 'playing' || m.spectator || now >= club.endsAt!) return { ok: false, reason: 'No race running' };
    const next = acceptProgress(m, report, now, club.startsAt!);
    if (!next) return { ok: false, reason: 'Rejected' };
    if (next.solved > m.solved) m.reachedAt = now;
    m.solved = next.solved;
    m.strikes = next.strikes;
    club.lastActivity = now;
    club.touch();
    phaseChanged = club.endIfDone() || phaseChanged;
    return { ok: true, club, phaseChanged };
  }

  /** The member's connection dropped: keep them listed as disconnected for a while. */
  disconnect(id: string): { club: Club; phaseChanged: boolean } | null {
    const club = this.clubOf(id);
    const m = club?.members.get(id);
    if (!club || !m) return null;
    m.connected = false;
    m.disconnectedAt = this.now();
    club.reassignHost();
    club.touch();
    return { club, phaseChanged: club.endIfDone() };
  }

  /**
   * Periodic work: move phases with the clock, drop members who stayed disconnected too long and close idle
   * rooms. `changed` lists rooms whose phase or membership changed (broadcast at once); `closed` lists rooms
   * that are gone, with the members still in them at that moment.
   */
  tick(now = this.now()): { changed: Club[]; closed: { club: Club; memberIds: string[] }[] } {
    const changed: Club[] = [];
    const closed: { club: Club; memberIds: string[] }[] = [];
    for (const club of [...this.clubs.values()]) {
      if (now - club.lastActivity >= this.idleMs) {
        closed.push({ club, memberIds: [...club.members.keys()] });
        this.close(club);
        continue;
      }
      let touched = club.advance(now);
      for (const m of [...club.members.values()]) {
        if (m.connected || now - m.disconnectedAt < this.disconnectMs) continue;
        this.byMember.delete(m.id);
        club.removeMember(m.id);
        touched = true;
      }
      if (club.members.size === 0) {
        this.clubs.delete(club.code);
        closed.push({ club, memberIds: [] });
        continue;
      }
      if (club.endIfDone()) touched = true;
      if (touched) changed.push(club);
    }
    return { changed, closed };
  }

  private close(club: Club): void {
    for (const id of club.members.keys()) this.byMember.delete(id);
    this.clubs.delete(club.code);
  }

  private hostClub(id: string): ClubResult {
    const club = this.clubOf(id);
    if (!club) return { ok: false, reason: 'Not in a club' };
    if (club.hostId !== id) return { ok: false, reason: 'Only the host can do that' };
    return { ok: true, club, phaseChanged: false };
  }
}
