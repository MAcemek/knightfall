import { describe, expect, it } from 'vitest';
import { CLUB_IDLE_MS, DEFAULT_BATTLE_SETTINGS } from '@knightfall/core';
import { CLUB_BROADCAST_MS, CLUB_DISCONNECT_MS, ClubRegistry, rankMembers } from './club.ts';

const DURATION = DEFAULT_BATTLE_SETTINGS.durationMs;

const make = (o: { maxPlayers?: number } = {}) => {
  let now = 1_000_000;
  let n = 0;
  const codes = ['AAAAAA', 'BBBBBB', 'CCCCCC'];
  const reg = new ClubRegistry({ now: () => now, genCode: () => codes[Math.min(n++, 2)], genSeed: () => 42, countdownMs: 3000, ...o });
  return { reg, advance: (ms: number) => (now += ms), at: () => now };
};
const p = (id: string) => ({ id, name: id.toUpperCase(), rating: 1200 });
const solve = (reg: ClubRegistry, id: string, solved: number, strikes: number) => reg.progress(id, { index: solved + strikes - 1, solved, strikes });

/** A room with host h and members a, b, created and then started. */
function lobby() {
  const t = make();
  const club = t.reg.create(p('h'), DEFAULT_BATTLE_SETTINGS);
  t.reg.join('AAAAAA', p('a'));
  t.reg.join('AAAAAA', p('b'));
  return { ...t, club };
}
/** The same room, already in the playing phase. */
function racing() {
  const t = lobby();
  t.reg.start('h');
  t.advance(3000);
  t.reg.tick();
  return t;
}

describe('rankMembers', () => {
  it('orders by solved, then fewer strikes, then who got there first', () => {
    const m = (id: string, solved: number, strikes: number, reachedAt: number | null) => ({ id, solved, strikes, reachedAt });
    const out = rankMembers([m('a', 3, 1, 50), m('b', 4, 2, 90), m('c', 4, 0, 99), m('d', 3, 1, 40), m('e', 0, 0, null), m('f', 3, 1, 40)]);
    expect(out.map((x) => x.id)).toEqual(['c', 'b', 'd', 'f', 'a', 'e']);
  });
});

describe('ClubRegistry lobby', () => {
  it('creates a room whose creator is the host, each room with its own code', () => {
    const { reg } = make();
    const a = reg.create(p('h'), DEFAULT_BATTLE_SETTINGS);
    const b = reg.create(p('h2'), DEFAULT_BATTLE_SETTINGS);
    expect([a.code, b.code]).toEqual(['AAAAAA', 'BBBBBB']);
    expect(a.hostId).toBe('h');
    expect(reg.clubOf('h')).toBe(a);
  });

  it('joins by code in any case and format, and rejects unknown codes', () => {
    const { reg } = make();
    reg.create(p('h'), DEFAULT_BATTLE_SETTINGS);
    expect(reg.join('aaa-aaa', p('a')).ok).toBe(true);
    expect(reg.join('ZZZZZZ', p('b'))).toEqual({ ok: false, reason: 'Room not found' });
    expect(reg.join(7, p('b'))).toEqual({ ok: false, reason: 'Room not found' });
    expect(reg.clubOf('b')).toBeNull();
  });

  it('caps the room at the maximum number of players', () => {
    const { reg } = make({ maxPlayers: 3 });
    reg.create(p('h'), DEFAULT_BATTLE_SETTINGS);
    expect(reg.join('AAAAAA', p('a')).ok).toBe(true);
    expect(reg.join('AAAAAA', p('b')).ok).toBe(true);
    expect(reg.join('AAAAAA', p('c'))).toEqual({ ok: false, reason: 'Room is full' });
  });

  it('hands the host over to the earliest remaining member, and closes an empty room', () => {
    const { reg, club } = lobby();
    expect(reg.leave('h')).toMatchObject({ closed: false });
    expect(club.hostId).toBe('a');
    reg.leave('a');
    expect(club.hostId).toBe('b');
    expect(reg.leave('b')).toMatchObject({ closed: true });
    expect(reg.get('AAAAAA')).toBeNull();
    expect(reg.size).toBe(0);
  });

  it('only the host starts, and only from the lobby', () => {
    const { reg } = lobby();
    expect(reg.start('a')).toEqual({ ok: false, reason: 'Only the host can do that' });
    expect(reg.start('nobody')).toEqual({ ok: false, reason: 'Not in a club' });
    expect(reg.start('h').ok).toBe(true);
    expect(reg.start('h')).toEqual({ ok: false, reason: 'A race is already running' });
  });
});

describe('ClubRegistry race', () => {
  it('start sets the seed and times, then the clock moves countdown to playing to ended', () => {
    const { reg, advance, at, club } = lobby();
    const t0 = at();
    reg.start('h');
    expect(club).toMatchObject({ phase: 'countdown', seed: 42, startsAt: t0 + 3000, endsAt: t0 + 3000 + DURATION });
    advance(3000);
    expect(reg.tick().changed).toEqual([club]);
    expect(club.phase).toBe('playing');
    advance(DURATION);
    expect(reg.tick().changed).toEqual([club]);
    expect(club.phase).toBe('ended');
  });

  it('ignores progress during the countdown and after the end', () => {
    const { reg, advance, club } = lobby();
    reg.start('h');
    expect(solve(reg, 'a', 1, 0).ok).toBe(false);
    advance(3000 + DURATION);
    expect(solve(reg, 'a', 1, 0).ok).toBe(false);
    expect(club.phase).toBe('ended');
  });

  it('applies the 1v1 acceptance rules (one result per report)', () => {
    const { reg } = racing();
    expect(reg.progress('a', { index: 0, solved: 2, strikes: 0 }).ok).toBe(false);
    expect(solve(reg, 'a', 1, 0).ok).toBe(true);
    expect(solve(reg, 'a', 1, 1).ok).toBe(true);
  });

  it('ranks by solved, fewer strikes, then first to reach the score', () => {
    const { reg, advance, club } = racing();
    solve(reg, 'a', 1, 0);
    advance(1000);
    solve(reg, 'b', 1, 0);
    advance(1000);
    solve(reg, 'h', 1, 0);
    solve(reg, 'h', 1, 1);
    advance(1000);
    solve(reg, 'b', 2, 0);
    expect(club.players().map((x) => x.id)).toEqual(['b', 'a', 'h']);
    advance(DURATION);
    reg.tick();
    expect(club.players().map((x) => [x.id, x.place])).toEqual([
      ['b', 1],
      ['a', 2],
      ['h', 3],
    ]);
  });

  it('only puts places on the ended race', () => {
    const { club } = racing();
    expect(club.players().every((x) => x.place === undefined)).toBe(true);
  });

  it('ends early when everybody has struck out', () => {
    const { reg, club } = racing();
    for (const id of ['h', 'a', 'b']) for (let i = 1; i <= 3; i++) solve(reg, id, 0, i);
    expect(club.phase).toBe('ended');
    expect(club.players().every((x) => x.out)).toBe(true);
  });

  it('a late joiner is a spectator: not ranked, cannot score, and does not hold the race open', () => {
    const { reg, club } = racing();
    expect(reg.join('AAAAAA', p('late')).ok).toBe(true);
    expect(club.players().map((x) => x.id)).not.toContain('late');
    expect(solve(reg, 'late', 1, 0).ok).toBe(false);
    for (const id of ['h', 'a', 'b']) for (let i = 1; i <= 3; i++) solve(reg, id, 0, i);
    expect(club.phase).toBe('ended');
    expect(reg.newRace('h').ok).toBe(true);
    expect(club.players().map((x) => x.id)).toEqual(['h', 'a', 'b', 'late']);
  });

  it('new race: host only, after the end, resets scores and the race fields', () => {
    const { reg, advance, club } = racing();
    solve(reg, 'a', 1, 0);
    expect(reg.newRace('h')).toEqual({ ok: false, reason: 'The race is not over yet' });
    advance(DURATION);
    expect(reg.newRace('a')).toEqual({ ok: false, reason: 'Only the host can do that' });
    expect(reg.newRace('h').ok).toBe(true);
    expect(club.phase).toBe('lobby');
    expect(club.seed).toBeUndefined();
    expect(club.players().every((x) => x.solved === 0 && x.strikes === 0 && !x.out)).toBe(true);
    expect(reg.start('h').ok).toBe(true);
  });

  it('a leaver mid-race is removed, and the race can end because of it', () => {
    const { reg, club } = racing();
    for (const id of ['h', 'a']) for (let i = 1; i <= 3; i++) solve(reg, id, 0, i);
    expect(club.phase).toBe('playing');
    expect(reg.leave('b')).toMatchObject({ phaseChanged: true });
    expect(club.phase).toBe('ended');
  });
});

describe('ClubRegistry connections and closing', () => {
  it('a disconnect marks the member, and they are removed after 60 s', () => {
    const { reg, advance, club } = lobby();
    reg.disconnect('a');
    expect(club.players().find((x) => x.id === 'a')?.connected).toBe(false);
    advance(CLUB_DISCONNECT_MS - 1);
    expect(reg.tick().changed).toEqual([]);
    advance(1);
    expect(reg.tick().changed).toEqual([club]);
    expect(club.members.has('a')).toBe(false);
    expect(reg.clubOf('a')).toBeNull();
  });

  it('a disconnected host passes the room on once removed', () => {
    const { reg, advance, club } = lobby();
    reg.disconnect('h');
    advance(CLUB_DISCONNECT_MS);
    reg.tick();
    expect(club.hostId).toBe('a');
  });

  it('a room whose members all disconnected closes when they are removed', () => {
    const { reg, advance } = make();
    reg.create(p('h'), DEFAULT_BATTLE_SETTINGS);
    reg.disconnect('h');
    advance(CLUB_DISCONNECT_MS);
    expect(reg.tick().closed).toHaveLength(1);
    expect(reg.size).toBe(0);
  });

  it('closes an idle room after 30 minutes and reports who was in it', () => {
    const { reg, advance } = make();
    reg.create(p('h'), DEFAULT_BATTLE_SETTINGS);
    reg.join('AAAAAA', p('a'));
    advance(CLUB_IDLE_MS - 1);
    expect(reg.tick().closed).toEqual([]);
    advance(1);
    expect(reg.tick().closed.map((c) => c.memberIds)).toEqual([['h', 'a']]);
    expect(reg.size).toBe(0);
    expect(reg.clubOf('a')).toBeNull();
  });

  it('activity keeps a room open', () => {
    const { reg, advance } = make();
    reg.create(p('h'), DEFAULT_BATTLE_SETTINGS);
    advance(CLUB_IDLE_MS - 1000);
    reg.join('AAAAAA', p('a'));
    advance(CLUB_IDLE_MS - 1000);
    expect(reg.tick().closed).toEqual([]);
  });
});

describe('Club broadcast and state', () => {
  it('sends at most every 250 ms unless forced, and only when something changed', () => {
    const { club } = lobby();
    expect(club.takeBroadcast(1000, false)).toBe(true);
    expect(club.takeBroadcast(1000 + CLUB_BROADCAST_MS, false)).toBe(false); // nothing changed
    club.touch();
    expect(club.takeBroadcast(1000 + CLUB_BROADCAST_MS - 1, false)).toBe(false);
    expect(club.takeBroadcast(1000 + CLUB_BROADCAST_MS, false)).toBe(true);
    expect(club.takeBroadcast(1000 + CLUB_BROADCAST_MS, true)).toBe(true);
  });

  it('state carries the race fields only outside the lobby, and spectators are absent from players', () => {
    const { reg, club } = racing();
    reg.join('AAAAAA', p('late'));
    const st = club.state('late', 5);
    expect(st).toMatchObject({ code: 'AAAAAA', you: 'late', hostId: 'h', phase: 'playing', seed: 42, serverNow: 5 });
    expect(st.players.map((x) => x.id)).toEqual(['h', 'a', 'b']);
    const fresh = make().reg.create(p('h'), DEFAULT_BATTLE_SETTINGS).state('h', 1);
    expect('seed' in fresh).toBe(false);
  });
});
