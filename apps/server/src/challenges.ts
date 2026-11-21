import { randomBytes, randomInt } from 'node:crypto';
import { BATTLE_CHALLENGE_TTL_MS, BATTLE_CODE_ALPHABET, BATTLE_CODE_LENGTH, isValidCode, type BattleSettings } from '@knightfall/core';

/** An unbound code stays reserved for its owner this long after they disconnect. */
export const CODE_RESERVE_MS = 24 * 60 * 60 * 1000;
export const MAX_INCOMING = 3;
const MAX_TOKEN_LENGTH = 64;
export const RATE_LIMIT_COUNT = 6;
export const RATE_LIMIT_WINDOW_MS = 60_000;

export const randomCode = (): string => {
  let out = '';
  for (let i = 0; i < BATTLE_CODE_LENGTH; i++) out += BATTLE_CODE_ALPHABET[randomInt(BATTLE_CODE_ALPHABET.length)];
  return out;
};
export const randomToken = (): string => randomBytes(16).toString('hex');

interface CodeEntry {
  sessionId: string | null;
  token: string;
  lastSeen: number;
}

export interface CodeRegistryOptions {
  now?: () => number;
  genCode?: () => string;
  genToken?: () => string;
  reserveMs?: number;
}

/** Maps friend codes to sessions. A code survives reconnects (proved by its token) and is reserved after disconnect. */
export class CodeRegistry {
  private readonly entries = new Map<string, CodeEntry>();
  private readonly codeOfSession = new Map<string, string>();
  private readonly now: () => number;
  private readonly genCode: () => string;
  private readonly genToken: () => string;
  private readonly reserveMs: number;

  constructor(o: CodeRegistryOptions = {}) {
    this.now = o.now ?? Date.now;
    this.genCode = o.genCode ?? randomCode;
    this.genToken = o.genToken ?? randomToken;
    this.reserveMs = o.reserveMs ?? CODE_RESERVE_MS;
  }

  /**
   * Give a session its code.
   * - Known code + matching token: rebind it to this session. If it was bound to another live session (fast
   *   reconnect, the old socket not closed yet) the binding moves and the old session id is returned as
   *   `displaced`, so the caller can clean up its pending challenges.
   * - Known code + different token: fresh code (the code's owner is known, nobody can take it).
   * - Unknown, well-formed code + token (the server restarted and forgot it): adopt it with that token.
   * - Anything else: fresh code.
   * A session that is already bound keeps its code.
   */
  bind(sessionId: string, code?: string, token?: string): { code: string; token: string; displaced?: string } {
    this.sweep();
    const own = this.codeOfSession.get(sessionId);
    if (own) {
      const e = this.entries.get(own)!;
      e.lastSeen = this.now();
      return { code: own, token: e.token };
    }
    if (code && token) {
      const e = this.entries.get(code);
      if (e && e.token === token) {
        const displaced = e.sessionId ?? undefined;
        if (displaced) this.codeOfSession.delete(displaced);
        e.sessionId = sessionId;
        e.lastSeen = this.now();
        this.codeOfSession.set(sessionId, code);
        return { code, token: e.token, ...(displaced ? { displaced } : {}) };
      }
      if (!e && isValidCode(code) && token.length <= MAX_TOKEN_LENGTH) {
        this.entries.set(code, { sessionId, token, lastSeen: this.now() });
        this.codeOfSession.set(sessionId, code);
        return { code, token };
      }
    }
    let fresh = this.genCode();
    while (this.entries.has(fresh)) fresh = this.genCode();
    const entry: CodeEntry = { sessionId, token: this.genToken(), lastSeen: this.now() };
    this.entries.set(fresh, entry);
    this.codeOfSession.set(sessionId, fresh);
    return { code: fresh, token: entry.token };
  }

  /** The session disconnected: keep the code reserved for its owner. */
  unbind(sessionId: string): void {
    const code = this.codeOfSession.get(sessionId);
    if (!code) return;
    this.codeOfSession.delete(sessionId);
    const e = this.entries.get(code);
    if (e) {
      e.sessionId = null;
      e.lastSeen = this.now();
    }
  }

  /** True while the code exists (bound or still reserved). */
  knows(code: string): boolean {
    this.sweep();
    return this.entries.has(code);
  }

  sessionOf(code: string): string | null {
    return this.entries.get(code)?.sessionId ?? null;
  }

  codeOf(sessionId: string): string | null {
    return this.codeOfSession.get(sessionId) ?? null;
  }

  /** Free unbound codes whose reservation ran out. */
  sweep(): void {
    const now = this.now();
    for (const [code, e] of this.entries) {
      if (e.sessionId === null && now - e.lastSeen >= this.reserveMs) this.entries.delete(code);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface Challenge {
  id: string;
  from: string;
  to: string;
  expiresAt: number;
  /** Set when the sender chose friend battle options (new clients only). */
  settings?: BattleSettings;
  series?: 1 | 3;
}

export interface BoardOptions {
  now?: () => number;
  genId?: () => string;
  ttlMs?: number;
  maxIncoming?: number;
  rateCount?: number;
  rateWindowMs?: number;
}

let idCounter = 0;
const defaultId = () => `ch-${Date.now().toString(36)}-${(++idCounter).toString(36)}-${randomBytes(4).toString('hex')}`;

/** Pending challenges. One outgoing per sender, a few incoming per target, and a per-sender rate limit. */
export class ChallengeBoard {
  private readonly byId = new Map<string, Challenge>();
  private readonly sends = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly genId: () => string;
  private readonly ttlMs: number;
  private readonly maxIncoming: number;
  private readonly rateCount: number;
  private readonly rateWindowMs: number;

  constructor(o: BoardOptions = {}) {
    this.now = o.now ?? Date.now;
    this.genId = o.genId ?? defaultId;
    this.ttlMs = o.ttlMs ?? BATTLE_CHALLENGE_TTL_MS;
    this.maxIncoming = o.maxIncoming ?? MAX_INCOMING;
    this.rateCount = o.rateCount ?? RATE_LIMIT_COUNT;
    this.rateWindowMs = o.rateWindowMs ?? RATE_LIMIT_WINDOW_MS;
  }

  /**
   * Rate limit: records one attempt and returns true while the sender is under the limit. Call it for every
   * challenge attempt (also ones that end up offline/busy) so codes cannot be probed without limit.
   */
  allow(from: string): boolean {
    const recent = this.recent(from);
    if (recent.length >= this.rateCount) return false;
    this.sends.set(from, [...recent, this.now()]);
    return true;
  }

  /**
   * Create a challenge. Returns it plus the ones displaced by it: the sender's previous outgoing
   * (`replaced`) and the target's oldest incoming when over the cap (`evicted`).
   */
  create(from: string, to: string, options: { settings?: BattleSettings; series?: 1 | 3 } = {}): { challenge: Challenge; replaced: Challenge | null; evicted: Challenge[] } {
    const now = this.now();
    const replaced = this.outgoing(from);
    if (replaced) this.byId.delete(replaced.id);
    const evicted: Challenge[] = [];
    for (let inc = this.incoming(to); inc.length >= this.maxIncoming; inc = this.incoming(to)) {
      const oldest = inc[0];
      this.byId.delete(oldest.id);
      evicted.push(oldest);
    }
    const challenge: Challenge = { id: this.genId(), from, to, expiresAt: now + this.ttlMs, ...options };
    this.byId.set(challenge.id, challenge);
    return { challenge, replaced, evicted };
  }

  get(id: string): Challenge | null {
    return this.byId.get(id) ?? null;
  }

  remove(id: string): Challenge | null {
    const c = this.byId.get(id) ?? null;
    this.byId.delete(id);
    return c;
  }

  outgoing(from: string): Challenge | null {
    for (const c of this.byId.values()) if (c.from === from) return c;
    return null;
  }

  /** Oldest first. */
  incoming(to: string): Challenge[] {
    return [...this.byId.values()].filter((c) => c.to === to);
  }

  /** Remove and return challenges whose time is up. */
  takeExpired(now = this.now()): Challenge[] {
    const out = [...this.byId.values()].filter((c) => c.expiresAt <= now);
    for (const c of out) this.byId.delete(c.id);
    for (const [id, times] of this.sends) {
      const keep = times.filter((t) => now - t < this.rateWindowMs);
      if (keep.length) this.sends.set(id, keep);
      else this.sends.delete(id);
    }
    return out;
  }

  get size(): number {
    return this.byId.size;
  }

  private recent(from: string): number[] {
    const now = this.now();
    return (this.sends.get(from) ?? []).filter((t) => now - t < this.rateWindowMs);
  }
}
