import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATTLE_RECONNECT_MS, type BattleSettings, type ServerMessage } from '@knightfall/core';
import { BattleHub, Session } from './hub.ts';

type Client = { s: Session; inbox: ServerMessage[] };

const hubs: BattleHub[] = [];
const newHub = () => {
  const hub = new BattleHub();
  hubs.push(hub);
  return hub;
};

const BASE = ['settings', 'club'];
const RECONNECT = [...BASE, 'reconnect'];
const COUNTDOWN = 3000;
const GRACE = BATTLE_RECONNECT_MS;
const MIN1: BattleSettings = { durationMs: 60_000, level: 'harder' };

function connect(hub: BattleHub, name: string, rating = 1200, opts: { hello?: boolean; code?: string; token?: string; caps?: string[]; resume?: string } = {}): Client {
  const inbox: ServerMessage[] = [];
  const s = new Session((m) => inbox.push(m));
  if (opts.hello !== false) hub.handle(s, { type: 'hello', player: { name, rating }, code: opts.code, token: opts.token, caps: opts.caps, resume: opts.resume });
  return { s, inbox };
}

const ofType = <T extends ServerMessage['type']>(c: Client, type: T) => c.inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
const last = <T extends ServerMessage['type']>(c: Client, type: T) => ofType(c, type).at(-1);
const code = (c: Client) => last(c, 'welcome')!.code;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  hubs.splice(0).forEach((h) => h.stop());
  vi.useRealTimers();
});

/** Two hello'd players matched by the queue; `into` ms pass after the match (the countdown is 3 s). */
function match(opts: { capsA?: string[]; capsB?: string[]; into?: number } = {}) {
  const hub = newHub();
  const a = connect(hub, 'Ann', 1200, { caps: opts.capsA ?? RECONNECT });
  const b = connect(hub, 'Bob', 1200, { caps: opts.capsB ?? RECONNECT });
  hub.handle(a.s, { type: 'queue', player: { name: 'Ann', rating: 1200 } });
  hub.handle(b.s, { type: 'queue', player: { name: 'Bob', rating: 1200 } });
  vi.advanceTimersByTime(opts.into ?? COUNTDOWN);
  return { hub, a, b, roomId: last(a, 'matched')!.roomId };
}

/** Ann says hello again on a new socket with her code and token, naming the room she wants back. */
function comeBack(hub: BattleHub, a: Client, resume: string | undefined, caps = RECONNECT): Client {
  const { code: c, token } = last(a, 'welcome')!;
  return connect(hub, 'Ann', 1200, { caps, code: c, token, resume });
}

describe('reconnect grace (1v1)', () => {
  it('a drop mid-battle holds the seat: no end, and the opponent is told', () => {
    const { hub, a, b } = match();
    hub.disconnect(a.s);
    expect(ofType(b, 'end')).toEqual([]);
    expect(last(b, 'opponent-away')).toEqual({ type: 'opponent-away', graceMs: GRACE });
  });

  it('without a reconnect inside the grace the opponent wins exactly as before', () => {
    const { hub, a, b } = match();
    hub.disconnect(a.s);
    vi.advanceTimersByTime(GRACE - 1);
    expect(ofType(b, 'end')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(last(b, 'end')).toMatchObject({ result: 'win', reason: 'opponent-left' });
    expect(ofType(a, 'end')).toEqual([]);
  });

  it('coming back in time gets the same room, both scores and the clock, and the battle goes on', () => {
    const { hub, a, b, roomId } = match();
    const first = last(a, 'matched')!;
    vi.advanceTimersByTime(1000);
    hub.handle(a.s, { type: 'progress', index: 0, solved: 1, strikes: 0 });
    vi.advanceTimersByTime(1000);
    hub.handle(b.s, { type: 'progress', index: 0, solved: 0, strikes: 1 });
    hub.disconnect(a.s);
    vi.advanceTimersByTime(5000);
    const a2 = comeBack(hub, a, roomId);
    expect(last(a2, 'welcome')).toBeTruthy();
    expect(last(a2, 'matched')).toMatchObject({
      roomId,
      seed: first.seed,
      opponent: { name: 'Bob' },
      resume: { me: { solved: 1, strikes: 0 }, opp: { solved: 0, strikes: 1 } },
    });
    expect(last(a2, 'start')).toMatchObject({ startsAt: last(a, 'start')!.startsAt, endsAt: last(a, 'start')!.endsAt });
    expect(last(b, 'opponent-back')).toEqual({ type: 'opponent-back' });
    // The new session plays on and the opponent sees it. The old grace timer is gone.
    vi.advanceTimersByTime(1000);
    hub.handle(a2.s, { type: 'progress', index: 1, solved: 2, strikes: 0 });
    expect(last(b, 'opponent-progress')).toMatchObject({ solved: 2 });
    vi.advanceTimersByTime(GRACE * 2);
    expect(ofType(b, 'end')).toEqual([]);
    vi.advanceTimersByTime(180_000);
    expect(last(a2, 'end')).toMatchObject({ result: 'win', reason: 'time', you: { solved: 2 }, opponent: { strikes: 1 } });
  });

  it('a drop during the countdown is held too', () => {
    const { hub, a, b, roomId } = match({ into: 1000 });
    hub.disconnect(a.s);
    vi.advanceTimersByTime(1500);
    const a2 = comeBack(hub, a, roomId);
    expect(last(a2, 'matched')).toMatchObject({ roomId, resume: { me: { solved: 0 }, opp: { solved: 0 } } });
    vi.advanceTimersByTime(2000);
    hub.handle(a2.s, { type: 'progress', index: 0, solved: 1, strikes: 0 });
    expect(last(b, 'opponent-progress')).toMatchObject({ solved: 1 });
    expect(ofType(b, 'end')).toEqual([]);
  });

  it('the clock runs on while away: a player who returns after the end is sent the result', () => {
    const hub = newHub();
    const x = connect(hub, 'Ann', 1200, { caps: RECONNECT });
    const y = connect(hub, 'Bob', 1200, { caps: RECONNECT });
    hub.handle(x.s, { type: 'challenge', code: code(y), settings: MIN1 });
    hub.handle(y.s, { type: 'challenge-respond', id: last(y, 'challenge-received')!.id, accept: true });
    vi.advanceTimersByTime(COUNTDOWN + 50_000);
    hub.disconnect(x.s);
    vi.advanceTimersByTime(10_000);
    expect(last(y, 'end')).toMatchObject({ reason: 'time' });
    const x2 = comeBack(hub, x, last(x, 'matched')!.roomId);
    expect(x2.inbox.map((m) => m.type)).toEqual(['welcome', 'matched', 'start', 'end']);
  });

  it('the old socket may still be open: the new hello with resume takes the seat and the old close changes nothing', () => {
    const { hub, a, b, roomId } = match();
    const a2 = comeBack(hub, a, roomId);
    expect(last(a2, 'matched')).toMatchObject({ roomId });
    hub.disconnect(a.s); // the dead socket is noticed late
    vi.advanceTimersByTime(GRACE * 2);
    expect(ofType(b, 'end')).toEqual([]);
    expect(ofType(b, 'opponent-away')).toEqual([]);
  });

  it('a hello without resume, or with another room id, does not take the seat', () => {
    const { hub, a, b } = match();
    hub.disconnect(a.s);
    expect(ofType(comeBack(hub, a, undefined), 'matched')).toEqual([]);
    expect(ofType(comeBack(hub, a, 'room-other'), 'matched')).toEqual([]);
    vi.advanceTimersByTime(GRACE);
    expect(last(b, 'end')).toMatchObject({ result: 'win', reason: 'opponent-left' });
  });

  it('a client that did not announce reconnect still forfeits at once, and its opponent hears nothing new', () => {
    const { hub, a, b } = match({ capsA: BASE, capsB: BASE });
    hub.disconnect(a.s);
    expect(last(b, 'end')).toMatchObject({ result: 'win', reason: 'opponent-left' });
    expect(ofType(b, 'opponent-away')).toEqual([]);
  });

  it('a client that sends neither hello nor caps (an old app) forfeits at once', () => {
    const hub = newHub();
    const x = connect(hub, 'Old1', 1200, { hello: false });
    const y = connect(hub, 'Old2', 1200, { hello: false });
    hub.handle(x.s, { type: 'queue', player: { name: 'Old1', rating: 1200 } });
    hub.handle(y.s, { type: 'queue', player: { name: 'Old2', rating: 1200 } });
    vi.advanceTimersByTime(COUNTDOWN);
    hub.disconnect(x.s);
    expect(y.inbox.map((m) => m.type)).toEqual(['queued', 'matched', 'start', 'end']);
    expect(last(y, 'end')).toMatchObject({ result: 'win', reason: 'opponent-left' });
  });

  it('a hello without caps keeps working and plays a normal battle against a new client', () => {
    const { hub, a, b } = match({ capsA: undefined, capsB: [] });
    vi.advanceTimersByTime(1000);
    hub.handle(b.s, { type: 'progress', index: 0, solved: 1, strikes: 0 });
    expect(last(a, 'opponent-progress')).toMatchObject({ solved: 1 });
    hub.disconnect(b.s);
    expect(last(a, 'end')).toMatchObject({ result: 'win', reason: 'opponent-left' });
  });

  it('an opponent that does not know reconnecting is not sent the away message', () => {
    const { hub, a, b } = match({ capsB: BASE });
    hub.disconnect(a.s);
    expect(ofType(b, 'opponent-away')).toEqual([]);
    expect(ofType(b, 'end')).toEqual([]);
  });

  it('a resume from a client that did not announce reconnect is ignored', () => {
    const { hub, a, roomId } = match();
    hub.disconnect(a.s);
    expect(ofType(comeBack(hub, a, roomId, BASE), 'matched')).toEqual([]);
  });

  it('after the grace the returning player finds nothing to resume', () => {
    const { hub, a, roomId } = match();
    hub.disconnect(a.s);
    vi.advanceTimersByTime(GRACE);
    expect(ofType(comeBack(hub, a, roomId), 'matched')).toEqual([]);
  });

  it('leaving on purpose still ends the battle at once', () => {
    const { hub, a, b } = match();
    hub.handle(a.s, { type: 'leave' });
    expect(last(b, 'end')).toMatchObject({ result: 'win', reason: 'opponent-left' });
  });

  it('a held player cannot make progress: the score stays frozen until they are back', () => {
    const { hub, a, b } = match();
    vi.advanceTimersByTime(1000);
    hub.handle(a.s, { type: 'progress', index: 0, solved: 1, strikes: 0 });
    hub.disconnect(a.s);
    hub.handle(a.s, { type: 'progress', index: 1, solved: 2, strikes: 0 }); // a late frame of the dead socket
    expect(ofType(b, 'opponent-progress')).toHaveLength(1);
  });
});

describe('club rejoin (hub)', () => {
  const create = (hub: BattleHub, host: Client) => {
    hub.handle(host.s, { type: 'club-create' });
    return last(host, 'club-state')!.code;
  };
  const rejoin = (hub: BattleHub, c: Client, roomCode: string) => {
    const c2 = comeBack(hub, c, undefined, BASE);
    hub.handle(c2.s, { type: 'club-join', code: roomCode });
    return c2;
  };
  const solve = (hub: BattleHub, c: Client, solved: number, strikes: number) => {
    vi.advanceTimersByTime(300);
    hub.handle(c.s, { type: 'progress', index: solved + strikes - 1, solved, strikes });
  };

  function race() {
    const hub = newHub();
    const h = connect(hub, 'Host', 1500, { caps: BASE });
    const a = connect(hub, 'Ann', 1200, { caps: BASE });
    const roomCode = create(hub, h);
    hub.handle(a.s, { type: 'club-join', code: roomCode });
    hub.handle(h.s, { type: 'club-start' });
    vi.advanceTimersByTime(COUNTDOWN);
    hub.tick();
    return { hub, h, a, roomCode };
  }

  it('a dropped racer who joins again with the same code keeps score and is still a racer', () => {
    const { hub, h, a, roomCode } = race();
    solve(hub, a, 1, 0);
    solve(hub, a, 2, 0);
    solve(hub, a, 2, 1);
    hub.disconnect(a.s);
    vi.advanceTimersByTime(300);
    hub.tick();
    expect(last(h, 'club-state')!.players.find((p) => p.name === 'Ann')).toMatchObject({ connected: false, solved: 2, strikes: 1 });
    vi.advanceTimersByTime(5000);
    const a2 = rejoin(hub, a, roomCode);
    const state = last(a2, 'club-state')!;
    expect(state.phase).toBe('playing');
    expect(state.players.map((p) => p.name).sort()).toEqual(['Ann', 'Host']);
    expect(state.players.find((p) => p.id === state.you)).toMatchObject({ name: 'Ann', solved: 2, strikes: 1, connected: true });
    // No ghost, and she keeps racing from where she was.
    solve(hub, a2, 3, 1);
    expect(last(h, 'club-state')!.players.find((p) => p.name === 'Ann')).toMatchObject({ solved: 3, strikes: 1, connected: true });
  });

  it('the late close of the old socket does not mark the rejoined member away', () => {
    const { hub, h, a, roomCode } = race();
    const a2 = rejoin(hub, a, roomCode);
    hub.disconnect(a.s);
    vi.advanceTimersByTime(61_000);
    hub.tick();
    expect(last(h, 'club-state')!.players.find((p) => p.name === 'Ann')).toMatchObject({ connected: true });
    expect(last(a2, 'club-state')!.players).toHaveLength(2);
  });

  it('a host who drops alone and rejoins is host again', () => {
    const hub = newHub();
    const h = connect(hub, 'Ann', 1200, { caps: BASE });
    const roomCode = create(hub, h);
    hub.disconnect(h.s);
    const h2 = rejoin(hub, h, roomCode);
    expect(last(h2, 'club-state')).toMatchObject({ hostId: last(h2, 'club-state')!.you });
    expect(last(h2, 'club-state')!.players).toHaveLength(1);
  });

  it('a member who never comes back is still removed after 60 s', () => {
    const { hub, h, a } = race();
    hub.disconnect(a.s);
    vi.advanceTimersByTime(61_000);
    hub.tick();
    expect(last(h, 'club-state')!.players.map((p) => p.name)).toEqual(['Host']);
  });

  it('someone else with another code is a new member (a spectator mid-race), not a rebind', () => {
    const { hub, h, roomCode } = race();
    const other = connect(hub, 'Ann', 1200, { caps: BASE });
    hub.handle(other.s, { type: 'club-join', code: roomCode });
    expect(last(h, 'club-state')!.players.map((p) => p.name)).toEqual(['Host', 'Ann']);
    const state = last(other, 'club-state')!;
    expect(state.players.find((p) => p.id === state.you)).toBeUndefined();
  });
});
