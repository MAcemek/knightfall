import { describe, expect, it } from 'vitest';
import { DEFAULT_BATTLE_SETTINGS, type ClubPlayer, type ServerMessage } from '@knightfall/core';
import { CLUB_NO_ANSWER_TEXT, CLUB_OUTDATED_TEXT, CLUB_REPLY_TIMEOUT_MS, clubBlockedText, clubErrorText, clubLabel, clubLink, clubReducer, clubRecord, initialClubState, isHost, ordinal, rankPlayers, type ClubRoom } from './clubLogic.ts';

const pl = (id: string, solved: number, strikes = 0, extra: Partial<ClubPlayer> = {}): ClubPlayer => ({
  id, name: id, rating: 1200, solved, strikes, out: false, connected: true, ...extra,
});
const state = (phase: 'lobby' | 'countdown' | 'playing' | 'ended', players: ClubPlayer[], extra: Partial<Extract<ServerMessage, { type: 'club-state' }>> = {}): ServerMessage => ({
  type: 'club-state', code: 'ABC234', you: 'a', hostId: 'a', phase, players, settings: DEFAULT_BATTLE_SETTINGS, serverNow: 0, ...extra,
});
const feed = (...msgs: ServerMessage[]) => msgs.reduce((s, msg) => clubReducer(s, { type: 'server', msg }), initialClubState);

describe('clubReducer', () => {
  it('tracks pending, then the room', () => {
    let s = clubReducer(initialClubState, { type: 'pending', kind: 'join' });
    expect(s.pending).toBe('join');
    s = clubReducer(s, { type: 'server', msg: state('lobby', [pl('a', 0)]) });
    expect(s.pending).toBeNull();
    expect(s.room).toMatchObject({ code: 'ABC234', phase: 'lobby', participating: true });
  });
  it('turns club-error into text and clears pending', () => {
    const s = clubReducer({ ...initialClubState, pending: 'join' }, { type: 'server', msg: { type: 'club-error', reason: 'full' } });
    expect(s).toMatchObject({ pending: null, error: 'That club room is full.' });
  });
  it('treats a late joiner as a spectator until the next lobby', () => {
    let s = feed(state('playing', [pl('a', 1)], { seed: 1, startsAt: 5, endsAt: 9 }));
    expect(s.room?.participating).toBe(false);
    s = clubReducer(s, { type: 'server', msg: state('ended', [pl('a', 1, 0, { place: 1 })]) });
    expect(s.room?.participating).toBe(false);
    s = clubReducer(s, { type: 'server', msg: state('lobby', [pl('a', 0)]) });
    expect(s.room?.participating).toBe(true);
  });
  it('keeps participating through a race I started in', () => {
    const s = feed(state('lobby', [pl('a', 0)]), state('countdown', [pl('a', 0)], { startsAt: 5 }), state('playing', [pl('a', 2)], { startsAt: 5, endsAt: 9 }));
    expect(s.room?.participating).toBe(true);
    expect(s.room?.startsAt).toBe(5);
  });
  it('fails a pending request with a message', () => {
    const s = clubReducer({ ...initialClubState, pending: 'create' }, { type: 'fail', error: 'nope' });
    expect(s).toMatchObject({ pending: null, error: 'nope' });
  });
  it('resets on leave and reports a lost connection', () => {
    const s = feed(state('lobby', [pl('a', 0)]));
    expect(clubReducer(s, { type: 'left' })).toEqual(initialClubState);
    expect(clubReducer({ ...initialClubState, pending: 'join' }, { type: 'connection-lost' }).error).toMatch(/Lost connection/);
    expect(clubReducer(initialClubState, { type: 'connection-lost' })).toBe(initialClubState);
  });
  it('keeps the room on screen after a lost connection, until it is joined again or given up', () => {
    const s = feed(state('playing', [pl('a', 1)], { seed: 1, startsAt: 5, endsAt: 9 }));
    const lost = clubReducer(s, { type: 'connection-lost' });
    expect(lost).toMatchObject({ reconnecting: true, error: null, room: { code: 'ABC234' } });
    expect(clubReducer(lost, { type: 'connection-lost' })).toBe(lost);
    // The server answers the new join with a state of the same room: back to normal.
    const back = clubReducer(lost, { type: 'server', msg: state('playing', [pl('a2', 2)], { seed: 1, startsAt: 5, endsAt: 9, you: 'a2' }) });
    expect(back).toMatchObject({ reconnecting: false, room: { you: 'a2' } });
    // The room is gone: closed for me, as before.
    const failed = clubReducer(lost, { type: 'rejoin-failed' });
    expect(failed).toEqual({ ...initialClubState, error: 'Lost connection to the battle server. The club room was closed for you.' });
    expect(clubReducer(s, { type: 'rejoin-failed' })).toBe(s);
  });
  it('a racer who rejoins is still a racer', () => {
    const s = feed(state('lobby', [pl('a', 0)]), state('playing', [pl('a', 1)], { startsAt: 5, endsAt: 9, seed: 1 }));
    const back = clubReducer(clubReducer(s, { type: 'connection-lost' }), { type: 'server', msg: state('playing', [pl('a2', 1)], { startsAt: 5, endsAt: 9, seed: 1, you: 'a2' }) });
    expect(back.room?.participating).toBe(true);
  });
});

describe('rankPlayers', () => {
  it('orders by solved, then strikes, and shares ranks on ties', () => {
    const r = rankPlayers([pl('a', 3, 1), pl('b', 5), pl('c', 3, 0), pl('d', 3, 0)]);
    expect(r.map((x) => [x.player.id, x.rank])).toEqual([['b', 1], ['c', 2], ['d', 2], ['a', 4]]);
  });
  it('uses the server place when known', () => {
    const r = rankPlayers([pl('a', 1, 0, { place: 2 }), pl('b', 1, 0, { place: 1 })]);
    expect(r.map((x) => [x.player.id, x.rank])).toEqual([['b', 1], ['a', 2]]);
  });
});

describe('wording and links', () => {
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th']);
  });
  it('labels and links', () => {
    expect(clubLabel({ place: 3, players: 12 })).toBe('Club race · 3rd of 12');
    expect(clubLink('https://x.app', 'ABC234')).toBe('https://x.app/battle?club=ABC234');
    expect(clubErrorText('weird')).toMatch(/Something went wrong/);
  });
  it('knows the host', () => {
    const room = feed(state('lobby', [pl('a', 0)])).room as ClubRoom;
    expect(isHost(room)).toBe(true);
    expect(isHost({ ...room, you: 'b' })).toBe(false);
  });
});

describe('clubRecord', () => {
  const ended = (participating = true): ClubRoom => {
    const room = feed(state('ended', [pl('a', 3, 1, { place: 2 }), pl('b', 5, 0, { place: 1 }), pl('c', 1, 3, { place: 3 })])).room as ClubRoom;
    return { ...room, participating };
  };
  it('records place and player count', () => {
    expect(clubRecord(ended(), 9)).toMatchObject({
      at: 9, result: 'loss', friendly: true, club: { place: 2, players: 3 }, you: { solved: 3, strikes: 1 }, opponent: { solved: 5, strikes: 0 },
      ratingBefore: 1200, ratingAfter: 1200,
    });
  });
  it('is a win for first place', () => {
    const room = { ...ended(), you: 'b' };
    expect(clubRecord(room, 1)).toMatchObject({ result: 'win', club: { place: 1, players: 3 } });
  });
  it('skips spectators and unfinished races', () => {
    expect(clubRecord(ended(false), 1)).toBeNull();
    expect(clubRecord({ ...ended(), phase: 'playing' }, 1)).toBeNull();
  });
});

describe('clubBlockedText', () => {
  it('blocks an outdated server and one that did not announce club support', () => {
    expect(clubBlockedText('outdated', ['club'])).toBe(CLUB_OUTDATED_TEXT);
    expect(clubBlockedText('online', [])).toBe(CLUB_OUTDATED_TEXT);
    expect(clubBlockedText('online', ['settings'])).toBe(CLUB_OUTDATED_TEXT);
    expect(clubBlockedText('online', ['settings', 'club'])).toBeNull();
  });
  it('has a bounded reply timeout and its own wording', () => {
    expect(CLUB_REPLY_TIMEOUT_MS).toBe(8000);
    expect(CLUB_NO_ANSWER_TEXT).toBe("The battle server didn't answer. Try again.");
  });
});
