import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@knightfall/core';
import type { ConnEvent, ConnSnapshot } from './connection.ts';

/** Store-level tests of the friend flow against a fake connection (no socket, no IndexedDB). */

const fake = vi.hoisted(() => ({
  snap: null as unknown as ConnSnapshot,
  player: { name: 'Me', rating: 1200 },
  sent: [] as ClientMessage[],
  listeners: new Set<(e: ConnEvent) => void>(),
  setPlayer: vi.fn(),
  resume: (() => undefined) as () => string | undefined,
  battlesAdd: vi.fn(),
  setKV: vi.fn(),
}));

vi.mock('./connection.ts', () => ({
  OFFLINE_MESSAGE: 'offline',
  subscribe: (fn: (e: ConnEvent) => void) => {
    fake.listeners.add(fn);
    return () => fake.listeners.delete(fn);
  },
  send: (m: ClientMessage) => {
    fake.sent.push(m);
    return true;
  },
  getSnapshot: () => fake.snap,
  getPlayer: () => fake.player,
  setPlayer: fake.setPlayer,
  setResumeProvider: (fn: () => string | undefined) => {
    fake.resume = fn;
  },
  serverNow: () => Date.now(),
  whenOpen: () => Promise.resolve(),
  reconnectNow: () => {},
  start: () => {},
}));
vi.mock('../db.ts', () => ({
  db: { battles: { add: fake.battlesAdd } },
  defaults: { battleRating: 1200 },
  KEYS: { battleRating: 'battleRating', recentOpponents: 'recentOpponents' },
  getKV: (_k: string, d: unknown) => Promise.resolve(d),
  setKV: fake.setKV,
}));
vi.mock('../profile.ts', () => ({ getPlayerName: () => Promise.resolve('Me') }));
vi.mock('../toast.tsx', () => ({ toast: vi.fn() }));

type Store = typeof import('./store.ts');
let store: Store;

const emit = (msg: ServerMessage) => fake.listeners.forEach((fn) => fn({ type: 'message', msg }));
const closed = () => fake.listeners.forEach((fn) => fn({ type: 'closed' }));
const online = (patch: Partial<ConnSnapshot> = {}): ConnSnapshot => ({ status: 'online', code: 'ABCDEF', socketOpen: true, moved: false, serverCaps: ['settings', 'club'], ...patch });

beforeEach(async () => {
  vi.resetModules();
  fake.snap = online();
  fake.player = { name: 'Me', rating: 1200 };
  fake.sent = [];
  fake.listeners.clear();
  fake.setPlayer.mockClear();
  fake.battlesAdd.mockReset().mockResolvedValue(1);
  fake.setKV.mockReset().mockResolvedValue(undefined);
  store = await import('./store.ts');
  store.initBattleStore();
});

const invite = (id = 'c1') =>
  emit({ type: 'challenge-received', id, from: { name: 'GoldenRook58', rating: 1300 }, expiresAt: Date.now() + 60_000, serverNow: Date.now() });

describe('friend flow', () => {
  it('accepting an invitation answers the server, and the battle that follows is reachable from any page', () => {
    invite();
    expect(store.getChallengeSnapshot().incoming).toHaveLength(1);
    store.respondToInvite('c1', true);
    expect(fake.sent).toContainEqual({ type: 'challenge-respond', id: 'c1', accept: true });
    expect(store.getChallengeSnapshot().incoming).toHaveLength(0);
    // The page that handled the Accept may be unmounted: the store still receives matched/start.
    emit({ type: 'matched', roomId: 'r1', seed: 7, opponent: { name: 'GoldenRook58', rating: 1300 }, friendly: true });
    emit({ type: 'start', startsAt: Date.now() + 3000, endsAt: Date.now() + 180_000, serverNow: Date.now() });
    const s = store.getBattleState();
    expect(s.phase).toBe('matched');
    expect(s.match).toMatchObject({ roomId: 'r1', friendly: true, opponent: { name: 'GoldenRook58' } });
  });

  it('an old server (status outdated) gives the "updating" text and sends nothing', () => {
    fake.snap = online({ status: 'outdated', code: null });
    store.sendChallenge('ABCDEF');
    const out = store.getChallengeSnapshot().outgoing;
    expect(out).toEqual({ kind: 'result', status: 'server-outdated', name: null });
    expect(fake.sent.filter((m) => m.type === 'challenge')).toEqual([]);
  });

  it('a server without the settings capability still gets plain challenges, but not custom settings or a series', () => {
    fake.snap = online({ serverCaps: [] });
    store.sendChallenge('GHJKMN', { durationMs: 60_000, level: 'harder' }, 1);
    expect(store.getChallengeSnapshot().outgoing).toEqual({ kind: 'result', status: 'server-outdated', name: null });
    store.dismissChallengeResult();
    store.sendChallenge('GHJKMN', undefined, 3);
    expect(store.getChallengeSnapshot().outgoing).toMatchObject({ kind: 'result', status: 'server-outdated' });
    expect(fake.sent.filter((m) => m.type === 'challenge')).toEqual([]);
    store.dismissChallengeResult();
    store.sendChallenge('GHJKMN');
    expect(fake.sent.filter((m) => m.type === 'challenge')).toEqual([{ type: 'challenge', code: 'GHJKMN' }]);
  });

  it('a friendly battle leaves the battle rating unchanged and is stored as friendly', () => {
    emit({ type: 'matched', roomId: 'r2', seed: 1, opponent: { name: 'Bo', rating: 1000 }, friendly: true });
    emit({ type: 'end', result: 'win', reason: 'time', you: { solved: 5, strikes: 0 }, opponent: { solved: 1, strikes: 1 } });
    const end = store.getBattleState().end!;
    expect(end.ratingAfter).toBe(end.ratingBefore);
    expect(fake.setPlayer).not.toHaveBeenCalled();
    expect(fake.setKV).not.toHaveBeenCalled();
    expect(fake.battlesAdd).toHaveBeenCalledWith(expect.objectContaining({ friendly: true, ratingBefore: 1200, ratingAfter: 1200 }));
  });

  it('a random battle still changes the rating (contrast)', () => {
    emit({ type: 'matched', roomId: 'r3', seed: 1, opponent: { name: 'Bo', rating: 1200 } });
    emit({ type: 'end', result: 'win', reason: 'time', you: { solved: 5, strikes: 0 }, opponent: { solved: 1, strikes: 1 } });
    expect(store.getBattleState().end!.ratingAfter).toBeGreaterThan(1200);
    expect(fake.setKV).toHaveBeenCalledWith('battleRating', expect.any(Number));
  });

  it('another tab taking the code drops invitations, fails a pending challenge and blocks new ones', () => {
    invite();
    store.sendChallenge('GHJKMN');
    expect(store.getChallengeSnapshot().outgoing.kind).toBe('sending');
    fake.snap = online({ moved: true });
    emit({ type: 'error', message: 'Friend challenges moved to another tab' });
    expect(store.getChallengeSnapshot().incoming).toHaveLength(0);
    expect(store.getChallengeSnapshot().outgoing).toMatchObject({ kind: 'result', status: 'server-moved' });
    fake.sent = [];
    store.dismissChallengeResult();
    store.sendChallenge('GHJKMN');
    expect(store.getChallengeSnapshot().outgoing).toMatchObject({ kind: 'result', status: 'server-moved' });
    expect(fake.sent).toEqual([]);
  });
});

describe('friend settings and recent opponents', () => {
  it('a plain challenge sends no extra fields; custom options are sent', () => {
    store.sendChallenge('GHJKMN');
    expect(fake.sent.filter((m) => m.type === 'challenge')).toEqual([{ type: 'challenge', code: 'GHJKMN' }]);
    store.cancelChallenge();
    fake.sent = [];
    const settings = { durationMs: 60_000 as const, level: 'harder' as const };
    store.sendChallenge('PQRSTV', settings, 3);
    expect(fake.sent.filter((m) => m.type === 'challenge')).toEqual([{ type: 'challenge', code: 'PQRSTV', settings, series: 3 }]);
  });

  it('keeps the settings on an invitation', () => {
    const settings = { durationMs: 300_000 as const, level: 'easier' as const };
    emit({ type: 'challenge-received', id: 'c9', from: { name: 'Ann', rating: 1000 }, expiresAt: Date.now() + 60_000, serverNow: Date.now(), settings, series: 3 });
    expect(store.getChallengeSnapshot().incoming[0]).toMatchObject({ id: 'c9', settings, series: 3 });
  });

  it('remembers a friendly opponent on matched and counts the result on end', async () => {
    emit({ type: 'matched', roomId: 'r9', seed: 1, opponent: { name: 'Bo', rating: 1000 }, friendly: true, opponentCode: 'ABCDEF', series: { length: 3, game: 1, me: 0, opp: 0 } });
    emit({ type: 'end', result: 'win', reason: 'time', you: { solved: 5, strikes: 0 }, opponent: { solved: 1, strikes: 1 } });
    await vi.waitFor(() => expect(fake.setKV).toHaveBeenCalledTimes(2));
    expect(fake.setKV).toHaveBeenNthCalledWith(1, 'recentOpponents', [expect.objectContaining({ code: 'ABCDEF', name: 'Bo', rating: 1000, w: 0 })]);
    expect(fake.battlesAdd).toHaveBeenCalledWith(expect.objectContaining({ opponentCode: 'ABCDEF', series: expect.objectContaining({ me: 1, opp: 0, over: false }) }));
  });
});

describe('reconnecting during a battle', () => {
  const play = () => {
    emit({ type: 'welcome', code: 'ABCDEF', token: 't', caps: ['settings', 'club', 'reconnect'] });
    emit({ type: 'matched', roomId: 'r1', seed: 3, opponent: { name: 'Bo', rating: 1200 } });
    emit({ type: 'start', startsAt: Date.now(), endsAt: Date.now() + 180_000, serverNow: Date.now() });
    store.goPlaying();
    fake.sent = [];
  };
  const puzzle = (i: number) => ({ id: `p${i}`, rating: 500 + i });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a drop keeps the match, asks for the room in the next hello, and gives up after 15 s', () => {
    play();
    closed();
    expect(store.getBattleState()).toMatchObject({ phase: 'playing', reconnectingSince: expect.any(Number) });
    expect(fake.resume()).toBe('r1');
    vi.advanceTimersByTime(14_999);
    expect(store.getBattleState().phase).toBe('playing');
    vi.advanceTimersByTime(1);
    expect(store.getBattleState()).toMatchObject({ phase: 'lobby', error: expect.stringMatching(/abandoned/) });
    expect(fake.resume()).toBeUndefined();
  });

  it('a server that cannot hold seats abandons the battle at once, as before', () => {
    emit({ type: 'welcome', code: 'ABCDEF', token: 't', caps: ['settings', 'club'] });
    emit({ type: 'matched', roomId: 'r1', seed: 3, opponent: { name: 'Bo', rating: 1200 } });
    closed();
    expect(store.getBattleState().phase).toBe('lobby');
    expect(store.getBattleState().error).toMatch(/abandoned/);
  });

  it('a server that does not announce reconnect when welcome arrives after the drop abandons the battle', () => {
    play();
    closed();
    emit({ type: 'welcome', code: 'ABCDEF', token: 't', caps: ['settings'] });
    expect(store.getBattleState().phase).toBe('lobby');
  });

  it('results made while offline are sent again after the resume, spaced out, and later ones wait their turn', () => {
    play();
    store.reportResult(puzzle(0), true); // reached the server
    expect(fake.sent).toEqual([{ type: 'progress', index: 0, solved: 1, strikes: 0 }]);
    closed();
    fake.sent = [];
    store.reportResult(puzzle(1), true);
    store.reportResult(puzzle(2), false);
    expect(fake.sent).toEqual([]);
    emit({
      type: 'matched', roomId: 'r1', seed: 3, opponent: { name: 'Bo', rating: 1200 },
      resume: { me: { solved: 1, strikes: 0 }, opp: { solved: 2, strikes: 0 } },
    });
    expect(store.getBattleState()).toMatchObject({ reconnectingSince: 0, opp: { solved: 2 }, me: { solved: 2, strikes: 1 } });
    expect(fake.sent).toEqual([{ type: 'progress', index: 1, solved: 2, strikes: 0 }]);
    store.reportResult(puzzle(3), true); // while the replay is running
    expect(fake.sent).toHaveLength(1);
    vi.advanceTimersByTime(400);
    expect(fake.sent.at(-1)).toEqual({ type: 'progress', index: 2, solved: 2, strikes: 1 });
    vi.advanceTimersByTime(400);
    expect(fake.sent.at(-1)).toEqual({ type: 'progress', index: 3, solved: 3, strikes: 1 });
    // Back to normal afterwards.
    vi.advanceTimersByTime(400);
    store.reportResult(puzzle(4), true);
    expect(fake.sent.at(-1)).toEqual({ type: 'progress', index: 4, solved: 4, strikes: 1 });
    expect(fake.sent).toHaveLength(4);
  });

  it('a resume whose server count already matches sends nothing again', () => {
    play();
    store.reportResult(puzzle(0), true);
    closed();
    fake.sent = [];
    emit({ type: 'matched', roomId: 'r1', seed: 3, opponent: { name: 'Bo', rating: 1200 }, resume: { me: { solved: 1, strikes: 0 }, opp: { solved: 0, strikes: 0 } } });
    expect(fake.sent).toEqual([]);
  });

  it('the end that happened while away arrives after the resume and finishes the battle', () => {
    play();
    closed();
    emit({ type: 'matched', roomId: 'r1', seed: 3, opponent: { name: 'Bo', rating: 1200 }, resume: { me: { solved: 0, strikes: 0 }, opp: { solved: 4, strikes: 0 } } });
    emit({ type: 'end', result: 'loss', reason: 'time', you: { solved: 0, strikes: 0 }, opponent: { solved: 4, strikes: 0 } });
    expect(store.getBattleState()).toMatchObject({ phase: 'ended', reconnectingSince: 0 });
  });

  it('an opponent who drops shows as away until they are back', () => {
    play();
    emit({ type: 'opponent-away', graceMs: 15_000 });
    expect(store.getBattleState().oppAway).toBe(true);
    emit({ type: 'opponent-back' });
    expect(store.getBattleState().oppAway).toBe(false);
  });
});
