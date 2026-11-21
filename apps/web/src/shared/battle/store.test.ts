import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@knightfall/core';
import type { ConnEvent, ConnSnapshot } from './connection.ts';

/** Store-level tests of the friend flow against a fake connection (no socket, no IndexedDB). */

const fake = vi.hoisted(() => ({
  snap: null as unknown as ConnSnapshot,
  player: { name: 'Me', rating: 1200 },
  sent: [] as ClientMessage[],
  listeners: new Set<(e: ConnEvent) => void>(),
  setPlayer: vi.fn(),
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
  serverNow: () => Date.now(),
  whenOpen: () => Promise.resolve(),
  reconnectNow: () => {},
  start: () => {},
}));
vi.mock('../db.ts', () => ({
  db: { battles: { add: fake.battlesAdd } },
  defaults: { battleRating: 1200 },
  KEYS: { battleRating: 'battleRating' },
  getKV: (_k: string, d: unknown) => Promise.resolve(d),
  setKV: fake.setKV,
}));
vi.mock('../profile.ts', () => ({ getPlayerName: () => Promise.resolve('Me') }));
vi.mock('../toast.tsx', () => ({ toast: vi.fn() }));

type Store = typeof import('./store.ts');
let store: Store;

const emit = (msg: ServerMessage) => fake.listeners.forEach((fn) => fn({ type: 'message', msg }));
const online = (patch: Partial<ConnSnapshot> = {}): ConnSnapshot => ({ status: 'online', code: 'ABCDEF', socketOpen: true, moved: false, ...patch });

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
