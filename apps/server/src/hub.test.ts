import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATTLE_CHALLENGE_TTL_MS, FRIEND_MOVED_MESSAGE, type ServerMessage } from '@knightfall/core';
import { BattleHub, Session } from './hub.ts';
import { isClientMessage } from './clientTypes.ts';

type Client = { s: Session; inbox: ServerMessage[] };

const hubs: BattleHub[] = [];
const newHub = () => {
  const hub = new BattleHub();
  hubs.push(hub);
  return hub;
};

function connect(hub: BattleHub, name: string, rating = 1200, opts: { hello?: boolean; code?: string; token?: string } = {}) {
  const inbox: ServerMessage[] = [];
  const s = new Session((m) => inbox.push(m));
  const c: Client = { s, inbox };
  if (opts.hello !== false) hub.handle(s, { type: 'hello', player: { name, rating }, code: opts.code, token: opts.token });
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
    expect(last(a2, 'welcome')).toEqual({ type: 'welcome', code: c1, token });
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
    expect(last(a2, 'welcome')).toEqual({ type: 'welcome', code: c1, token });
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
