import { describe, expect, it } from 'vitest';
import {
  codeProblem, EXPIRY_GRACE_MS, formatCodeInput, formatCountdown, idleOutgoing, incomingReducer, inviteDisplay, MAX_INCOMING, outgoingMessage, outgoingReducer,
  resultText, secondsLeft, SENDING_TIMEOUT_MS, topInvite, type ChallengeResult, type Invite, type OutgoingAction, type OutgoingState,
} from './challengeLogic.ts';

const runOut = (s: OutgoingState, ...a: OutgoingAction[]) => a.reduce(outgoingReducer, s);
const inv = (id: string, expiresAt: number): Invite => ({ id, from: { name: `P${id}`, rating: 1200 }, expiresAt });

describe('outgoing challenge', () => {
  const sending = runOut(idleOutgoing, { type: 'send', code: 'ABCDEF', at: 100 });

  it('goes idle -> sending -> waiting with the server expiry and the friend name', () => {
    expect(sending).toEqual({ kind: 'sending', code: 'ABCDEF', at: 100 });
    const waiting = outgoingReducer(sending, { type: 'status', status: 'sent', name: 'Ann', expiresAt: 60_000 });
    expect(waiting).toEqual({ kind: 'waiting', code: 'ABCDEF', name: 'Ann', expiresAt: 60_000 });
  });

  it('turns every refusal into a result and keeps the name', () => {
    const waiting = runOut(sending, { type: 'status', status: 'sent', name: 'Ann', expiresAt: 60_000 });
    expect(outgoingReducer(waiting, { type: 'status', status: 'declined' })).toEqual({ kind: 'result', status: 'declined', name: 'Ann' });
    expect(outgoingReducer(sending, { type: 'status', status: 'busy', name: 'Bo' })).toEqual({ kind: 'result', status: 'busy', name: 'Bo' });
    expect(outgoingReducer(sending, { type: 'status', status: 'invalid' })).toEqual({ kind: 'result', status: 'invalid', name: null });
  });

  it('ignores stray statuses when nothing is in flight and a repeated sent ack', () => {
    expect(outgoingReducer(idleOutgoing, { type: 'status', status: 'cancelled' })).toBe(idleOutgoing);
    const waiting = runOut(sending, { type: 'status', status: 'sent', expiresAt: 5 });
    expect(outgoingReducer(waiting, { type: 'status', status: 'sent', expiresAt: 9 })).toBe(waiting);
  });

  it('cancel, dismiss and a started battle clear it', () => {
    for (const type of ['cancel', 'dismiss', 'matched'] as const) expect(outgoingReducer(sending, { type })).toBe(idleOutgoing);
    expect(outgoingReducer(idleOutgoing, { type: 'cancel' })).toBe(idleOutgoing);
  });

  it('a lost connection ends a pending challenge only', () => {
    expect(outgoingReducer(sending, { type: 'connection-lost' })).toMatchObject({ kind: 'result', status: 'server-offline' });
    expect(outgoingReducer(idleOutgoing, { type: 'connection-lost' })).toBe(idleOutgoing);
  });

  it('gives up on an unacknowledged send and on a missed expiry message', () => {
    expect(outgoingReducer(sending, { type: 'tick', serverNow: 0, localNow: 100 + SENDING_TIMEOUT_MS })).toBe(sending);
    expect(outgoingReducer(sending, { type: 'tick', serverNow: 0, localNow: 101 + SENDING_TIMEOUT_MS })).toMatchObject({ status: 'unavailable' });
    const waiting = runOut(sending, { type: 'status', status: 'sent', name: 'Ann', expiresAt: 60_000 });
    expect(outgoingReducer(waiting, { type: 'tick', serverNow: 60_000, localNow: 0 })).toBe(waiting);
    expect(outgoingReducer(waiting, { type: 'tick', serverNow: 60_000 + EXPIRY_GRACE_MS, localNow: 0 })).toEqual({ kind: 'result', status: 'expired', name: 'Ann' });
  });
});

describe('incoming invitations', () => {
  it('adds, dedupes by id and keeps only the newest three', () => {
    let l: readonly Invite[] = [];
    l = incomingReducer(l, { type: 'received', invite: inv('1', 10) });
    expect(incomingReducer(l, { type: 'received', invite: inv('1', 10) })).toBe(l);
    for (const id of ['2', '3', '4']) l = incomingReducer(l, { type: 'received', invite: inv(id, 10) });
    expect(l.map((i) => i.id)).toEqual(['2', '3', '4']);
    expect(l).toHaveLength(MAX_INCOMING);
  });

  it('removes withdrawn and answered invitations, and clears', () => {
    const l = [inv('a', 10), inv('b', 20)];
    expect(incomingReducer(l, { type: 'withdrawn', id: 'a' }).map((i) => i.id)).toEqual(['b']);
    expect(incomingReducer(l, { type: 'respond', id: 'b' }).map((i) => i.id)).toEqual(['a']);
    expect(incomingReducer(l, { type: 'withdrawn', id: 'zzz' })).toBe(l);
    expect(incomingReducer(l, { type: 'clear' })).toEqual([]);
  });

  it('expires invitations by the server clock', () => {
    const l = [inv('a', 1000), inv('b', 2000)];
    expect(incomingReducer(l, { type: 'tick', serverNow: 999 })).toBe(l);
    expect(incomingReducer(l, { type: 'tick', serverNow: 1000 }).map((i) => i.id)).toEqual(['b']);
  });

  it('shows the invitation that expires soonest first', () => {
    expect(topInvite([inv('a', 3000), inv('b', 1000), inv('c', 2000)])?.id).toBe('b');
    expect(topInvite([])).toBeNull();
  });
});

describe('countdown and code input', () => {
  it('counts down on the server clock', () => {
    expect(secondsLeft(60_000, 0)).toBe(60);
    expect(secondsLeft(60_000, 59_001)).toBe(1);
    expect(secondsLeft(60_000, 70_000)).toBe(0);
    expect(formatCountdown(52)).toBe('0:52');
    expect(formatCountdown(60)).toBe('1:00');
  });

  it('formats typed codes live as XXX-XXX', () => {
    expect(formatCodeInput('7qx')).toBe('7QX');
    expect(formatCodeInput('7qxk')).toBe('7QX-K');
    expect(formatCodeInput(' 7qx-k4m ')).toBe('7QX-K4M');
    expect(formatCodeInput('7QXK4MZZZ')).toBe('7QX-K4M');
  });

  it('explains why a code cannot be sent yet', () => {
    expect(codeProblem('7QX')).toMatch(/6 characters/);
    expect(codeProblem('7QX-K40')).toMatch(/never use/);
    expect(codeProblem('7QX-K4M')).toBeNull();
  });
});

describe('messages', () => {
  const all: ChallengeResult[] = [
    'declined', 'expired', 'cancelled', 'offline', 'busy', 'self', 'invalid', 'rate-limited', 'unavailable',
    'server-offline', 'server-waking', 'server-connecting', 'server-outdated', 'outdated',
  ];
  it('has a distinct sentence for every outcome', () => {
    const texts = all.map((s) => resultText(s, 'Ann'));
    expect(new Set(texts).size).toBe(all.length);
    for (const t of texts) expect(t.length).toBeGreaterThan(10);
  });

  it('names the friend where it knows them', () => {
    expect(resultText('declined', 'Ann')).toBe('Ann declined your challenge.');
    expect(resultText('busy', 'Ann')).toMatch(/^Ann is in a battle/);
    expect(resultText('server-outdated', null)).toBe('Battle server is updating, try again in a minute.');
  });

  it('shows the waiting line with a countdown', () => {
    const s: OutgoingState = { kind: 'waiting', code: 'ABCDEF', name: 'Ann', expiresAt: 52_000 };
    expect(outgoingMessage(s, 0)).toEqual({ tone: 'info', text: 'Waiting for Ann… 0:52' });
    expect(outgoingMessage(idleOutgoing)).toBeNull();
  });
});

describe('inviteDisplay', () => {
  const invite = inv('a', 5000);
  const base = { invite, battleLive: false, timedPlay: false, expanded: false };

  it('shows the card normally, nothing without an invite or during a live battle', () => {
    expect(inviteDisplay(base)).toBe('card');
    expect(inviteDisplay({ ...base, invite: null })).toBe('none');
    expect(inviteDisplay({ ...base, battleLive: true, timedPlay: true })).toBe('none');
  });

  it('shows only a banner during timed play until it is expanded', () => {
    expect(inviteDisplay({ ...base, timedPlay: true })).toBe('banner');
    expect(inviteDisplay({ ...base, timedPlay: true, expanded: true })).toBe('card');
  });

  it('has text for the another-tab outcome', () => {
    expect(resultText('server-moved', null)).toBe('Friend challenges are active in another tab.');
    expect(resultText('outdated', 'Ann')).toBe('They need to reload Knightfall to play with custom settings.');
  });
});
