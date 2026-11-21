import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATTLE_CHALLENGE_TTL_MS, CLUB_IDLE_MS, CLUB_MAX_PLAYERS, FRIEND_MOVED_MESSAGE, SERVER_CAPS, type BattleSettings, type ServerMessage } from '@knightfall/core';
import { BattleHub, SERIES_GAP_MS, Session } from './hub.ts';
import { isClientMessage } from './clientTypes.ts';

type Client = { s: Session; inbox: ServerMessage[] };

const hubs: BattleHub[] = [];
const newHub = () => {
  const hub = new BattleHub();
  hubs.push(hub);
  return hub;
};

function connect(hub: BattleHub, name: string, rating = 1200, opts: { hello?: boolean; code?: string; token?: string; caps?: string[] } = {}) {
  const inbox: ServerMessage[] = [];
  const s = new Session((m) => inbox.push(m));
  const c: Client = { s, inbox };
  if (opts.hello !== false) hub.handle(s, { type: 'hello', player: { name, rating }, code: opts.code, token: opts.token, caps: opts.caps });
  return c;
}

const ofType = <T extends ServerMessage['type']>(c: Client, type: T) =>
  c.inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
const last = <T extends ServerMessage['type']>(c: Client, type: T) => ofType(c, type).at(-1);
const code = (c: Client) => last(c, 'welcome')!.code;
const statuses = (c: Client) => ofType(c, 'challenge-status').map((m) => m.status);

/** A sends a challenge to B's code; returns the received invitation id. */
function invite(hub: BattleHub, a: Client, b: Client): string {
  hub.handle(a.s, { type: 'challenge', code: code(b) });
  return last(b, 'challenge-received')!.id;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  hubs.splice(0).forEach((h) => h.stop());
  vi.useRealTimers();
});

describe('hello', () => {
  it('replies welcome with a valid code and token', () => {
    const a = connect(newHub(), 'Ann');
    expect(last(a, 'welcome')).toMatchObject({ type: 'welcome', code: expect.stringMatching(/^[A-Z2-9]{6}$/), token: expect.any(String) });
  });

  it('welcome announces what this server supports', () => {
    const a = connect(newHub(), 'Ann');
    expect(last(a, 'welcome')!.caps).toEqual([...SERVER_CAPS]);
    expect(last(a, 'welcome')!.caps).toEqual(expect.arrayContaining(['settings', 'club']));
  });

  it('a reconnect with code + token keeps the code', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const { code: c1, token } = last(a, 'welcome')!;
    hub.disconnect(a.s);
    const a2 = connect(hub, 'Ann', 1300, { code: c1, token });
    expect(code(a2)).toBe(c1);
  });

  it('a stolen code without the token gets a fresh one', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const mallory = connect(hub, 'Mallory', 1200, { code: code(a), token: 'wrong' });
    expect(code(mallory)).not.toBe(code(a));
  });

  it('restart: a fresh hub adopts the code + token a client still holds', () => {
    const old = newHub();
    const a = connect(old, 'Ann');
    const { code: c1, token } = last(a, 'welcome')!;
    old.stop();
    const fresh = newHub();
    const a2 = connect(fresh, 'Ann', 1200, { code: c1, token });
    expect(last(a2, 'welcome')).toEqual({ type: 'welcome', code: c1, token, caps: [...SERVER_CAPS] });
    const b = connect(fresh, 'Bob');
    fresh.handle(b.s, { type: 'challenge', code: c1 });
    expect(last(a2, 'challenge-received')).toBeTruthy();
    // someone else claiming the adopted code with another token gets a new code
    const m = connect(fresh, 'Mallory', 1200, { code: c1, token: 'wrong' });
    expect(code(m)).not.toBe(c1);
  });

  it('fast reconnect: a second session with the same code + token takes over before the first disconnects', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const { code: c1, token } = last(a, 'welcome')!;
    const b = connect(hub, 'Bob');
    const pending = invite(hub, a, b); // Ann has an outgoing invite when she reconnects
    const a2 = connect(hub, 'Ann', 1200, { code: c1, token });
    expect(last(a2, 'welcome')).toEqual({ type: 'welcome', code: c1, token, caps: [...SERVER_CAPS] });
    // the old session's pending invite is withdrawn cleanly
    expect(last(b, 'challenge-withdrawn')?.id).toBe(pending);
    hub.disconnect(a.s); // old socket finally closes
    hub.handle(b.s, { type: 'challenge', code: c1 });
    expect(last(a2, 'challenge-received')).toMatchObject({ from: { name: 'Bob' } });
    expect(ofType(a, 'challenge-received')).toHaveLength(0);
    const id = last(a2, 'challenge-received')!.id;
    hub.handle(a2.s, { type: 'challenge-respond', id, accept: true });
    expect(last(b, 'matched')).toMatchObject({ friendly: true, opponent: { name: 'Ann' } });
  });

  it('two tabs: the displaced one is told, and its later challenge gets unavailable (not silence)', () => {
    const hub = newHub();
    const tab1 = connect(hub, 'Ann');
    const { code: c1, token } = last(tab1, 'welcome')!;
    const tab2 = connect(hub, 'Ann', 1200, { code: c1, token });
    expect(ofType(tab1, 'error')).toEqual([{ type: 'error', message: FRIEND_MOVED_MESSAGE }]);
    expect(ofType(tab2, 'error')).toEqual([]);
    const bob = connect(hub, 'Bob');
    hub.handle(tab1.s, { type: 'challenge', code: code(bob) });
    expect(statuses(tab1)).toEqual(['unavailable']);
    expect(ofType(bob, 'challenge-received')).toHaveLength(0);
    // the other tab still works
    hub.handle(tab2.s, { type: 'challenge', code: code(bob) });
    expect(statuses(tab2)).toEqual(['sent']);
  });

  it('rejects an invalid player', () => {
    const hub = newHub();
    const c = connect(hub, 'x', 1200, { hello: false });
    hub.handle(c.s, { type: 'hello', player: { name: 'x', rating: NaN } });
    expect(last(c, 'error')).toBeTruthy();
    expect(last(c, 'welcome')).toBeUndefined();
  });

  it('the new client types are accepted by the server type guard', () => {
    for (const type of ['hello', 'challenge', 'challenge-cancel', 'challenge-respond']) expect(isClientMessage({ type })).toBe(true);
    expect(isClientMessage({ type: 'nope' })).toBe(false);
  });
});

describe('challenge flow', () => {
  it('challenge, accept: both get matched with friendly and start', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200);
    const b = connect(hub, 'Bob', 1900);
    const id = invite(hub, a, b);
    expect(last(a, 'challenge-status')).toMatchObject({ status: 'sent', name: 'Bob', expiresAt: 1_000_000 + BATTLE_CHALLENGE_TTL_MS, serverNow: 1_000_000 });
    expect(last(b, 'challenge-received')).toMatchObject({ from: { name: 'Ann', rating: 1200 }, expiresAt: 1_060_000, serverNow: 1_000_000 });
    hub.handle(b.s, { type: 'challenge-respond', id, accept: true });
    expect(last(a, 'matched')).toMatchObject({ friendly: true, opponent: { name: 'Bob' } });
    expect(last(b, 'matched')).toMatchObject({ friendly: true, opponent: { name: 'Ann' } });
    expect(last(a, 'matched')!.roomId).toBe(last(b, 'matched')!.roomId);
    expect(ofType(a, 'start')).toHaveLength(1);
    expect(ofType(b, 'start')).toHaveLength(1);
  });

  it('accepts a code typed with lowercase and a dash', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const c = code(b);
    hub.handle(a.s, { type: 'challenge', code: `${c.slice(0, 3)}-${c.slice(3)}`.toLowerCase() });
    expect(last(b, 'challenge-received')).toBeTruthy();
  });

  it('decline tells the sender', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const id = invite(hub, a, b);
    hub.handle(b.s, { type: 'challenge-respond', id, accept: false });
    expect(last(a, 'challenge-status')).toMatchObject({ status: 'declined', name: 'Bob' });
    expect(ofType(a, 'matched')).toHaveLength(0);
    // the invitation is gone: accepting it later does nothing
    hub.handle(b.s, { type: 'challenge-respond', id, accept: true });
    expect(ofType(a, 'matched')).toHaveLength(0);
  });

  it('cancel withdraws the invitation and tells the sender', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const id = invite(hub, a, b);
    hub.handle(a.s, { type: 'challenge-cancel' });
    expect(last(b, 'challenge-withdrawn')).toEqual({ type: 'challenge-withdrawn', id });
    expect(last(a, 'challenge-status')?.status).toBe('cancelled');
    hub.handle(b.s, { type: 'challenge-respond', id, accept: true });
    expect(ofType(b, 'matched')).toHaveLength(0);
  });

  it('expires after 60 s on tick: sender expired, target withdrawn', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const id = invite(hub, a, b);
    vi.advanceTimersByTime(59_000);
    hub.tick();
    expect(ofType(b, 'challenge-withdrawn')).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    hub.tick();
    expect(last(a, 'challenge-status')).toMatchObject({ status: 'expired', name: 'Bob' });
    expect(last(b, 'challenge-withdrawn')?.id).toBe(id);
    hub.handle(b.s, { type: 'challenge-respond', id, accept: true });
    expect(ofType(a, 'matched')).toHaveLength(0);
  });

  it('accepting an expired invitation before the tick reports expired', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const id = invite(hub, a, b);
    vi.advanceTimersByTime(BATTLE_CHALLENGE_TTL_MS);
    hub.handle(b.s, { type: 'challenge-respond', id, accept: true });
    expect(ofType(a, 'matched')).toHaveLength(0);
    expect(last(a, 'challenge-status')?.status).toBe('expired');
  });

  it('only the target can respond', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const c = connect(hub, 'Cy');
    const id = invite(hub, a, b);
    hub.handle(c.s, { type: 'challenge-respond', id, accept: true });
    hub.handle(a.s, { type: 'challenge-respond', id, accept: true });
    expect(ofType(a, 'matched')).toHaveLength(0);
    expect(last(b, 'challenge-received')?.id).toBe(id);
  });

  it('own code: self', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    hub.handle(a.s, { type: 'challenge', code: code(a) });
    expect(last(a, 'challenge-status')?.status).toBe('self');
  });

  it('bad format and unknown codes: invalid', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    hub.handle(a.s, { type: 'challenge', code: 'ABC' });
    hub.handle(a.s, { type: 'challenge', code: 'ABCDE0' });
    hub.handle(a.s, { type: 'challenge', code: 'ZZZZZZ' });
    expect(statuses(a)).toEqual(['invalid', 'invalid', 'invalid']);
  });

  it('a target that went offline: offline', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const bCode = code(b);
    hub.disconnect(b.s);
    hub.handle(a.s, { type: 'challenge', code: bCode });
    expect(last(a, 'challenge-status')?.status).toBe('offline');
  });

  it('a target in a live battle: busy; after it ends the challenge works', () => {
    const hub = newHub();
    const b = connect(hub, 'Bob');
    const c = connect(hub, 'Cy');
    const a = connect(hub, 'Ann');
    const idBC = invite(hub, c, b);
    hub.handle(b.s, { type: 'challenge-respond', id: idBC, accept: true });
    hub.handle(a.s, { type: 'challenge', code: code(b) });
    expect(last(a, 'challenge-status')).toMatchObject({ status: 'busy', name: 'Bob' });
    expect(ofType(b, 'challenge-received')).toHaveLength(1); // only the one Cy sent before the battle
    vi.advanceTimersByTime(3 * 60 * 1000 + 3000);
    expect(last(b, 'end')).toBeTruthy();
    hub.handle(a.s, { type: 'challenge', code: code(b) });
    expect(last(a, 'challenge-status')?.status).toBe('sent');
  });

  it('rate limits to 6 per minute', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    for (let i = 0; i < 6; i++) hub.handle(a.s, { type: 'challenge', code: code(b) });
    expect(statuses(a)).toEqual(Array(6).fill('sent'));
    hub.handle(a.s, { type: 'challenge', code: code(b) });
    expect(last(a, 'challenge-status')?.status).toBe('rate-limited');
    vi.advanceTimersByTime(60_000);
    hub.handle(a.s, { type: 'challenge', code: code(b) });
    expect(last(a, 'challenge-status')?.status).toBe('sent');
  });

  it('a second outgoing replaces the first, which is withdrawn from the first target', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const c = connect(hub, 'Cy');
    const id1 = invite(hub, a, b);
    invite(hub, a, c);
    expect(last(b, 'challenge-withdrawn')?.id).toBe(id1);
    hub.handle(b.s, { type: 'challenge-respond', id: id1, accept: true });
    expect(ofType(a, 'matched')).toHaveLength(0);
  });

  it('at most 3 incoming per target: the oldest is withdrawn', () => {
    const hub = newHub();
    const t = connect(hub, 'Target');
    const senders = ['A', 'B', 'C', 'D'].map((n) => connect(hub, n));
    const ids = senders.map((s) => invite(hub, s, t));
    expect(last(t, 'challenge-withdrawn')?.id).toBe(ids[0]);
    expect(last(senders[0], 'challenge-status')?.status).toBe('expired');
    expect(ofType(t, 'challenge-withdrawn')).toHaveLength(1);
  });

  it('disconnect of the sender mid-invite withdraws it', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const id = invite(hub, a, b);
    hub.disconnect(a.s);
    expect(last(b, 'challenge-withdrawn')?.id).toBe(id);
    hub.handle(b.s, { type: 'challenge-respond', id, accept: true });
    expect(ofType(b, 'matched')).toHaveLength(0);
  });

  it('disconnect of the target mid-invite tells the sender: offline', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    invite(hub, a, b);
    hub.disconnect(b.s);
    expect(last(a, 'challenge-status')).toMatchObject({ status: 'offline', name: 'Bob' });
    vi.advanceTimersByTime(BATTLE_CHALLENGE_TTL_MS + 1000);
    hub.tick();
    expect(statuses(a)).toEqual(['sent', 'offline']);
  });

  it('a reconnected target keeps its code and can be challenged again', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const { code: bCode, token } = last(b, 'welcome')!;
    hub.disconnect(b.s);
    const b2 = connect(hub, 'Bob', 1200, { code: bCode, token });
    hub.handle(a.s, { type: 'challenge', code: bCode });
    expect(last(b2, 'challenge-received')).toBeTruthy();
  });

  it('a sender who is in a live battle cannot challenge', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const c = connect(hub, 'Cy');
    hub.handle(b.s, { type: 'challenge-respond', id: invite(hub, a, b), accept: true });
    hub.handle(a.s, { type: 'challenge', code: code(c) });
    expect(last(a, 'challenge-status')?.status).toBe('unavailable');
    expect(ofType(c, 'challenge-received')).toHaveLength(0);
  });
});

describe('queue interplay', () => {
  it('sending a challenge removes the sender from the random queue', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    hub.handle(a.s, { type: 'queue', player: { name: 'Ann', rating: 1200 } });
    expect(hub.stats.queued).toBe(1);
    invite(hub, a, b);
    expect(hub.stats.queued).toBe(0);
  });

  it('queueing for a random battle cancels your own pending invite', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const id = invite(hub, a, b);
    hub.handle(b.s, { type: 'queue', player: { name: 'Bob', rating: 1200 } });
    hub.handle(a.s, { type: 'queue', player: { name: 'Ann', rating: 1200 } });
    // the two were matched randomly, and the invite is gone
    expect(hub.stats.queued).toBe(0);
    expect(last(a, 'challenge-status')?.status).toBe('cancelled');
    hub.handle(b.s, { type: 'challenge-respond', id, accept: true });
    expect(ofType(a, 'matched')).toHaveLength(1);
    expect(last(a, 'matched')!.friendly).toBeUndefined();
  });

  it('accepting while queued removes the target from the queue', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200);
    const b = connect(hub, 'Bob', 2500);
    const id = invite(hub, a, b);
    hub.handle(b.s, { type: 'queue', player: { name: 'Bob', rating: 2500 } });
    expect(hub.stats.queued).toBe(1);
    // b queueing does not touch a's outgoing invite to b; it is still valid
    hub.handle(b.s, { type: 'challenge-respond', id, accept: true });
    expect(hub.stats.queued).toBe(0);
    expect(last(a, 'matched')).toMatchObject({ friendly: true });
    expect(last(b, 'matched')).toMatchObject({ friendly: true });
    vi.advanceTimersByTime(60_000);
    hub.tick();
    expect(ofType(a, 'matched')).toHaveLength(1);
    expect(ofType(b, 'matched')).toHaveLength(1);
  });

  it('entering a battle declines other pending invitations with busy', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    const c = connect(hub, 'Cy');
    const idA = invite(hub, a, b);
    invite(hub, c, b);
    hub.handle(b.s, { type: 'challenge-respond', id: idA, accept: true });
    expect(last(c, 'challenge-status')).toMatchObject({ status: 'busy', name: 'Bob' });
  });
});

describe('rematch', () => {
  it('stays friendly', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    hub.handle(b.s, { type: 'challenge-respond', id: invite(hub, a, b), accept: true });
    vi.advanceTimersByTime(3 * 60 * 1000 + 3000);
    expect(last(a, 'end')).toBeTruthy();
    hub.handle(a.s, { type: 'rematch' });
    hub.handle(b.s, { type: 'rematch' });
    expect(ofType(a, 'matched')).toHaveLength(2);
    expect(last(a, 'matched')).toMatchObject({ friendly: true });
    expect(last(b, 'matched')).toMatchObject({ friendly: true });
  });

  it('a random match is not friendly and its rematch stays unrated', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200);
    const b = connect(hub, 'Bob', 1210);
    hub.handle(a.s, { type: 'queue', player: { name: 'Ann', rating: 1200 } });
    hub.handle(b.s, { type: 'queue', player: { name: 'Bob', rating: 1210 } });
    expect(last(a, 'matched')).toBeTruthy();
    expect('friendly' in last(a, 'matched')!).toBe(false);
  });
});

describe('backward compatibility', () => {
  it('an old-style client without hello still matchmakes (human pair and bot)', () => {
    const hub = newHub();
    const a = connect(hub, 'Old1', 1200, { hello: false });
    const b = connect(hub, 'Old2', 1210, { hello: false });
    hub.handle(a.s, { type: 'queue', player: { name: 'Old1', rating: 1200 } });
    hub.handle(b.s, { type: 'queue', player: { name: 'Old2', rating: 1210 } });
    expect(last(a, 'matched')).toMatchObject({ opponent: { name: 'Old2' } });
    expect('friendly' in last(a, 'matched')!).toBe(false);

    const c = connect(hub, 'Old3', 1200, { hello: false });
    hub.handle(c.s, { type: 'queue', player: { name: 'Old3', rating: 1200 } });
    vi.advanceTimersByTime(8000);
    hub.tick();
    expect(last(c, 'matched')).toBeTruthy();
    hub.disconnect(c.s);
    hub.disconnect(a.s);
    hub.disconnect(b.s);
  });

  it('a client that never sends hello never receives the new server messages', () => {
    const hub = newHub();
    const old = connect(hub, 'Old', 1200, { hello: false });
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    // others challenge and accept around it; old also tries every new message
    invite(hub, a, b);
    hub.handle(old.s, { type: 'challenge', code: code(b) });
    hub.handle(old.s, { type: 'challenge-cancel' });
    hub.handle(old.s, { type: 'challenge-respond', id: 'x', accept: true });
    hub.handle(old.s, { type: 'queue', player: { name: 'Old', rating: 1200 } });
    hub.handle(old.s, { type: 'cancel' });
    hub.handle(a.s, { type: 'challenge', code: 'ZZZZZZ' });
    vi.advanceTimersByTime(BATTLE_CHALLENGE_TTL_MS + 1000);
    hub.tick();
    hub.disconnect(old.s);
    const newTypes = ['welcome', 'challenge-status', 'challenge-received', 'challenge-withdrawn'];
    expect(old.inbox.filter((m) => newTypes.includes(m.type))).toEqual([]);
    expect(last(old, 'queued')).toBeTruthy();
  });
});

const NEW = ['settings', 'club'];
const MIN1: BattleSettings = { durationMs: 60_000, level: 'harder' };
const COUNTDOWN = 3000;

/** Ann challenges Bob with options and Bob accepts. */
function friendly(hub: BattleHub, a: Client, b: Client, settings?: BattleSettings, series?: 1 | 3) {
  hub.handle(a.s, { type: 'challenge', code: code(b), settings, series });
  hub.handle(b.s, { type: 'challenge-respond', id: last(b, 'challenge-received')!.id, accept: true });
}
/** The first player solves one puzzle, then the clock runs out: the first player wins the game. */
function firstWins(hub: BattleHub, a: Client, durationMs: number) {
  vi.advanceTimersByTime(COUNTDOWN);
  hub.handle(a.s, { type: 'progress', index: 0, solved: 1, strikes: 0 });
  vi.advanceTimersByTime(durationMs);
}

describe('friend settings', () => {
  it('carries settings and series into matched, with the opponent code, and ends on the chosen time', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    friendly(hub, a, b, MIN1, 3);
    expect(last(a, 'matched')).toMatchObject({
      friendly: true,
      opponentCode: code(b),
      settings: MIN1,
      series: { length: 3, game: 1, me: 0, opp: 0 },
    });
    expect(last(b, 'matched')).toMatchObject({ opponentCode: code(a), settings: MIN1, series: { length: 3, game: 1, me: 0, opp: 0 } });
    vi.advanceTimersByTime(COUNTDOWN + 59_000);
    expect(last(a, 'end')).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(last(a, 'end')).toMatchObject({ reason: 'time' });
  });

  it('the target sees the settings on the invitation; invalid values fall back to the defaults', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    hub.handle(a.s, { type: 'challenge', code: code(b), settings: MIN1, series: 3 });
    expect(last(b, 'challenge-received')).toMatchObject({ settings: MIN1, series: 3 });
    hub.handle(a.s, { type: 'challenge', code: code(b), settings: { durationMs: 7, level: 'nope' } as unknown as BattleSettings, series: 9 as unknown as 3 });
    expect(last(b, 'challenge-received')).toMatchObject({ settings: { durationMs: 180_000, level: 'normal' }, series: 1 });
  });

  it('non-default settings or a series to a target without the settings cap: outdated, nothing sent', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const old = connect(hub, 'Old');
    hub.handle(a.s, { type: 'challenge', code: code(old), settings: MIN1 });
    expect(last(a, 'challenge-status')).toMatchObject({ status: 'outdated', name: 'Old' });
    hub.handle(a.s, { type: 'challenge', code: code(old), series: 3 });
    expect(statuses(a)).toEqual(['outdated', 'outdated']);
    expect(ofType(old, 'challenge-received')).toHaveLength(0);
  });

  it('default settings still reach an old target, which sees no new fields', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const old = connect(hub, 'Old');
    hub.handle(a.s, { type: 'challenge', code: code(old), settings: { durationMs: 180_000, level: 'normal' }, series: 1 });
    expect(last(a, 'challenge-status')).toMatchObject({ status: 'sent' });
    const received = last(old, 'challenge-received')!;
    expect('settings' in received || 'series' in received).toBe(false);
    hub.handle(old.s, { type: 'challenge-respond', id: received.id, accept: true });
    expect(last(a, 'matched')).toMatchObject({ friendly: true, settings: { durationMs: 180_000, level: 'normal' }, series: { length: 1 } });
  });

  it('an old challenger (no settings) to a new target plays with the defaults', () => {
    const hub = newHub();
    const old = connect(hub, 'Old');
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    hub.handle(old.s, { type: 'challenge', code: code(b) });
    expect('settings' in last(b, 'challenge-received')!).toBe(false);
    hub.handle(b.s, { type: 'challenge-respond', id: last(b, 'challenge-received')!.id, accept: true });
    expect(last(b, 'matched')).toMatchObject({ friendly: true, settings: { durationMs: 180_000 } });
    vi.advanceTimersByTime(COUNTDOWN + 180_000);
    expect(last(old, 'end')).toBeTruthy();
  });

  it('opponentCode, settings and series appear only in friendly rooms', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1210, { caps: NEW });
    hub.handle(a.s, { type: 'queue', player: { name: 'Ann', rating: 1200 } });
    hub.handle(b.s, { type: 'queue', player: { name: 'Bob', rating: 1210 } });
    const m = last(a, 'matched')!;
    expect('opponentCode' in m || 'settings' in m || 'series' in m || 'friendly' in m).toBe(false);
    const c = connect(hub, 'Cy', 1200, { caps: NEW });
    hub.handle(c.s, { type: 'queue', player: { name: 'Cy', rating: 1200 } });
    vi.advanceTimersByTime(8000);
    hub.tick();
    const bm = last(c, 'matched')!;
    expect('opponentCode' in bm || 'settings' in bm || 'series' in bm).toBe(false);
  });
});

describe('best of 3', () => {
  it('runs to a decided result: the next game starts after the pause, nothing follows a decided series', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    friendly(hub, a, b, MIN1, 3);
    firstWins(hub, a, 60_000);
    expect(last(a, 'end')).toMatchObject({ result: 'win' });
    expect(ofType(a, 'matched')).toHaveLength(1);
    // busy while the next game is pending
    const c = connect(hub, 'Cy', 1200, { caps: NEW });
    hub.handle(c.s, { type: 'challenge', code: code(a) });
    expect(last(c, 'challenge-status')).toMatchObject({ status: 'busy' });
    vi.advanceTimersByTime(SERIES_GAP_MS);
    expect(ofType(a, 'matched')).toHaveLength(2);
    expect(last(a, 'matched')).toMatchObject({ series: { length: 3, game: 2, me: 1, opp: 0 }, settings: MIN1 });
    expect(last(b, 'matched')).toMatchObject({ series: { length: 3, game: 2, me: 0, opp: 1 } });
    // game 2: Ann wins again, the series is decided at 2 points
    firstWins(hub, a, 60_000);
    expect(ofType(a, 'end')).toHaveLength(2);
    vi.advanceTimersByTime(SERIES_GAP_MS * 2);
    expect(ofType(a, 'matched')).toHaveLength(2);
    expect(ofType(b, 'matched')).toHaveLength(2);
  });

  it('goes to a third game when the first two are split, and stops after it', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    friendly(hub, a, b, MIN1, 3);
    firstWins(hub, a, 60_000); // Ann 1-0
    vi.advanceTimersByTime(SERIES_GAP_MS + COUNTDOWN);
    hub.handle(b.s, { type: 'progress', index: 0, solved: 1, strikes: 0 });
    vi.advanceTimersByTime(60_000); // Bob wins game 2: 1-1
    vi.advanceTimersByTime(SERIES_GAP_MS);
    expect(last(a, 'matched')).toMatchObject({ series: { game: 3, me: 1, opp: 1 } });
    vi.advanceTimersByTime(COUNTDOWN + 60_000); // a draw in game 3
    expect(ofType(a, 'end')).toHaveLength(3);
    vi.advanceTimersByTime(SERIES_GAP_MS * 2);
    expect(ofType(a, 'matched')).toHaveLength(3);
  });

  it('a draw counts half a point: 0.5 after game 1', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    friendly(hub, a, b, MIN1, 3);
    vi.advanceTimersByTime(COUNTDOWN + 60_000);
    vi.advanceTimersByTime(SERIES_GAP_MS);
    expect(last(a, 'matched')).toMatchObject({ series: { game: 2, me: 0.5, opp: 0.5 } });
  });

  it('does not continue when someone leaves during the pause', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    friendly(hub, a, b, MIN1, 3);
    firstWins(hub, a, 60_000);
    hub.handle(b.s, { type: 'leave' });
    expect(last(a, 'opponent-left')).toBeTruthy();
    vi.advanceTimersByTime(SERIES_GAP_MS * 2);
    expect(ofType(a, 'matched')).toHaveLength(1);
  });

  it('a leaver mid-game ends the series with a win for the other player', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    friendly(hub, a, b, MIN1, 3);
    hub.disconnect(b.s);
    expect(last(a, 'end')).toMatchObject({ result: 'win', reason: 'opponent-left' });
    vi.advanceTimersByTime(SERIES_GAP_MS * 2);
    expect(ofType(a, 'matched')).toHaveLength(1);
  });

  it('a rematch is ignored during the pause, and after a decided series it starts a new series', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    friendly(hub, a, b, MIN1, 3);
    firstWins(hub, a, 60_000);
    hub.handle(a.s, { type: 'rematch' });
    hub.handle(b.s, { type: 'rematch' });
    expect(ofType(a, 'matched')).toHaveLength(1);
    vi.advanceTimersByTime(SERIES_GAP_MS);
    firstWins(hub, a, 60_000); // decided 2-0
    hub.handle(a.s, { type: 'rematch' });
    hub.handle(b.s, { type: 'rematch' });
    expect(ofType(a, 'matched')).toHaveLength(3);
    expect(last(a, 'matched')).toMatchObject({ settings: MIN1, series: { length: 3, game: 1, me: 0, opp: 0 } });
  });
});

describe('club rooms', () => {
  const create = (hub: BattleHub, host: Client, settings?: BattleSettings) => {
    hub.handle(host.s, { type: 'club-create', settings });
    return last(host, 'club-state')!.code;
  };
  const join = (hub: BattleHub, c: Client, roomCode: string) => hub.handle(c.s, { type: 'club-join', code: roomCode });
  const flush = (hub: BattleHub, ms = 300) => {
    vi.advanceTimersByTime(ms);
    hub.tick();
  };
  const solve = (hub: BattleHub, c: Client, solved: number, strikes: number) =>
    hub.handle(c.s, { type: 'progress', index: solved + strikes - 1, solved, strikes });
  const names = (c: Client) => last(c, 'club-state')!.players.map((p) => p.name);

  it('create, join, start: everyone gets the same seed and times, and only the host can start', () => {
    const hub = newHub();
    const h = connect(hub, 'Host', 1500, { caps: NEW });
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const roomCode = create(hub, h, MIN1);
    expect(last(h, 'club-state')).toMatchObject({ phase: 'lobby', hostId: last(h, 'club-state')!.you, settings: MIN1 });
    join(hub, a, roomCode.toLowerCase());
    expect(names(h)).toEqual(['Host', 'Ann']);
    expect(last(a, 'club-state')!.you).not.toBe(last(a, 'club-state')!.hostId);
    hub.handle(a.s, { type: 'club-start' });
    expect(last(a, 'club-error')).toMatchObject({ reason: 'Only the host can do that' });
    hub.handle(h.s, { type: 'club-start' });
    const sh = last(h, 'club-state')!;
    const sa = last(a, 'club-state')!;
    expect(sh).toMatchObject({ phase: 'countdown', seed: sa.seed, startsAt: 1_000_000 + COUNTDOWN, endsAt: 1_000_000 + COUNTDOWN + 60_000 });
    expect(sa.startsAt).toBe(sh.startsAt);
  });

  it('unknown codes get club-error', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    join(hub, a, 'ZZZZZZ');
    join(hub, a, 'nope');
    expect(ofType(a, 'club-error').map((m) => m.reason)).toEqual(['Room not found', 'Room not found']);
  });

  it('race: live ranking, places at the end, then new race resets', () => {
    const hub = newHub();
    const h = connect(hub, 'Host', 1200, { caps: NEW });
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    const roomCode = create(hub, h, MIN1);
    join(hub, a, roomCode);
    join(hub, b, roomCode);
    hub.handle(h.s, { type: 'club-start' });
    vi.advanceTimersByTime(COUNTDOWN);
    hub.tick();
    expect(last(h, 'club-state')!.phase).toBe('playing');
    solve(hub, a, 1, 0);
    vi.advanceTimersByTime(1000);
    solve(hub, b, 1, 0);
    vi.advanceTimersByTime(1000);
    solve(hub, b, 2, 0);
    solve(hub, h, 0, 1);
    flush(hub);
    expect(names(a)).toEqual(['Bob', 'Ann', 'Host']);
    expect(last(a, 'club-state')!.players[0]).toMatchObject({ solved: 2, strikes: 0, out: false, connected: true });
    expect(last(a, 'club-state')!.players.every((p) => p.place === undefined)).toBe(true);
    vi.advanceTimersByTime(60_000);
    hub.tick();
    const end = last(a, 'club-state')!;
    expect(end.phase).toBe('ended');
    expect(end.players.map((p) => [p.name, p.place])).toEqual([
      ['Bob', 1],
      ['Ann', 2],
      ['Host', 3],
    ]);
    hub.handle(a.s, { type: 'club-new-race' });
    expect(last(a, 'club-error')).toMatchObject({ reason: 'Only the host can do that' });
    hub.handle(h.s, { type: 'club-new-race' });
    expect(last(b, 'club-state')).toMatchObject({ phase: 'lobby' });
    expect(last(b, 'club-state')!.players.every((p) => p.solved === 0 && p.place === undefined)).toBe(true);
  });

  it('ends early when everyone has struck out', () => {
    const hub = newHub();
    const h = connect(hub, 'Host', 1200, { caps: NEW });
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    join(hub, a, create(hub, h));
    hub.handle(h.s, { type: 'club-start' });
    vi.advanceTimersByTime(COUNTDOWN);
    hub.tick();
    for (let i = 1; i <= 3; i++) {
      solve(hub, h, 0, i);
      solve(hub, a, 0, i);
    }
    expect(last(a, 'club-state')!.phase).toBe('ended');
  });

  it('a late joiner spectates (not in players) and races from the next race on', () => {
    const hub = newHub();
    const h = connect(hub, 'Host', 1200, { caps: NEW });
    const roomCode = create(hub, h, MIN1);
    hub.handle(h.s, { type: 'club-start' });
    const late = connect(hub, 'Late', 1200, { caps: NEW });
    join(hub, late, roomCode);
    const st = last(late, 'club-state')!;
    expect(st.phase).toBe('countdown');
    expect(st.players.map((p) => p.name)).toEqual(['Host']);
    vi.advanceTimersByTime(COUNTDOWN);
    hub.tick();
    solve(hub, late, 1, 0);
    flush(hub);
    expect(names(h)).toEqual(['Host']);
    vi.advanceTimersByTime(60_000);
    hub.tick();
    hub.handle(h.s, { type: 'club-new-race' });
    expect(names(late)).toEqual(['Host', 'Late']);
  });

  it('the host passes to the earliest remaining player; an empty room closes at once', () => {
    const hub = newHub();
    const h = connect(hub, 'Host', 1200, { caps: NEW });
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    const roomCode = create(hub, h);
    join(hub, a, roomCode);
    join(hub, b, roomCode);
    hub.handle(h.s, { type: 'club-leave' });
    const st = last(a, 'club-state')!;
    expect(st.hostId).toBe(st.you);
    expect(names(a)).toEqual(['Ann', 'Bob']);
    hub.handle(a.s, { type: 'club-leave' });
    hub.handle(b.s, { type: 'club-leave' });
    const c = connect(hub, 'Cy', 1200, { caps: NEW });
    join(hub, c, roomCode);
    expect(last(c, 'club-error')).toMatchObject({ reason: 'Room not found' });
  });

  it('caps a room at 30 players', () => {
    const hub = newHub();
    const h = connect(hub, 'Host', 1200, { caps: NEW });
    const roomCode = create(hub, h);
    for (let i = 1; i < CLUB_MAX_PLAYERS; i++) join(hub, connect(hub, `P${i}`, 1200, { caps: NEW }), roomCode);
    expect(last(h, 'club-state')!.players).toHaveLength(CLUB_MAX_PLAYERS);
    const extra = connect(hub, 'Extra', 1200, { caps: NEW });
    join(hub, extra, roomCode);
    expect(last(extra, 'club-error')).toMatchObject({ reason: 'Room is full' });
  });

  it('a disconnected member shows as disconnected and is removed after 60 s', () => {
    const hub = newHub();
    const h = connect(hub, 'Host', 1200, { caps: NEW });
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    join(hub, a, create(hub, h));
    hub.disconnect(a.s);
    flush(hub);
    expect(last(h, 'club-state')!.players.find((p) => p.name === 'Ann')?.connected).toBe(false);
    vi.advanceTimersByTime(60_000);
    hub.tick();
    expect(names(h)).toEqual(['Host']);
  });

  it('closes an idle room after 30 minutes and tells the members', () => {
    const hub = newHub();
    const h = connect(hub, 'Host', 1200, { caps: NEW });
    const roomCode = create(hub, h);
    vi.advanceTimersByTime(CLUB_IDLE_MS);
    hub.tick();
    expect(last(h, 'club-error')).toMatchObject({ reason: 'Room closed' });
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    join(hub, a, roomCode);
    expect(last(a, 'club-error')).toMatchObject({ reason: 'Room not found' });
  });

  it('members are busy for friend challenges and cannot queue; joining declines pending invitations', () => {
    const hub = newHub();
    const h = connect(hub, 'Host', 1200, { caps: NEW });
    const o = connect(hub, 'Other', 1200, { caps: NEW });
    create(hub, h);
    hub.handle(o.s, { type: 'challenge', code: code(h) });
    expect(last(o, 'challenge-status')).toMatchObject({ status: 'busy', name: 'Host' });
    hub.handle(h.s, { type: 'challenge', code: code(o) });
    expect(last(h, 'challenge-status')).toMatchObject({ status: 'unavailable' });
    hub.handle(h.s, { type: 'queue', player: { name: 'Host', rating: 1200 } });
    expect(last(h, 'error')).toMatchObject({ message: 'Leave the club room first' });
    // after leaving, challenges work again
    hub.handle(h.s, { type: 'club-leave' });
    hub.handle(o.s, { type: 'challenge', code: code(h) });
    expect(last(o, 'challenge-status')).toMatchObject({ status: 'sent' });
    // creating a room declines the invitation Other received... and withdraws the one Other sent
    create(hub, o);
    expect(last(h, 'challenge-withdrawn')).toBeTruthy();
  });

  it('cannot create while in a live battle; club codes are not friend codes', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann', 1200, { caps: NEW });
    const b = connect(hub, 'Bob', 1200, { caps: NEW });
    friendly(hub, a, b);
    hub.handle(a.s, { type: 'club-create' });
    expect(last(a, 'club-error')).toMatchObject({ reason: 'Finish your battle first' });
    const c = connect(hub, 'Cy', 1200, { caps: NEW });
    join(hub, c, code(a));
    expect(last(c, 'club-error')).toMatchObject({ reason: 'Room not found' });
  });

  it('a session that never said hello gets club-error and nothing else', () => {
    const hub = newHub();
    const old = connect(hub, 'Old', 1200, { hello: false });
    hub.handle(old.s, { type: 'club-create' });
    expect(old.inbox).toEqual([{ type: 'club-error', reason: 'Not connected yet' }]);
  });
});

describe('old clients (no caps) keep working', () => {
  it('hello without caps: a default friend challenge behaves as before and no series follows', () => {
    const hub = newHub();
    const a = connect(hub, 'Ann');
    const b = connect(hub, 'Bob');
    hub.handle(b.s, { type: 'challenge-respond', id: invite(hub, a, b), accept: true });
    expect(last(a, 'matched')).toMatchObject({ friendly: true, opponent: { name: 'Bob' } });
    vi.advanceTimersByTime(COUNTDOWN + 180_000);
    expect(last(a, 'end')).toMatchObject({ reason: 'time' });
    vi.advanceTimersByTime(SERIES_GAP_MS * 2);
    expect(ofType(a, 'matched')).toHaveLength(1);
  });
});
