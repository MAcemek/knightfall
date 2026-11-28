import { describe, expect, it } from 'vitest';
import {
  BATTLE_DURATION_MS,
  BATTLE_RECONNECT_MS,
  SERVER_CAPS,
  BATTLE_LEVEL_RAMP,
  BATTLE_RAMP,
  CLIENT_CAPS,
  CLUB_IDLE_MS,
  CLUB_MAX_PLAYERS,
  DEFAULT_BATTLE_SETTINGS,
  REACTIONS,
  REACTION_EMOJI,
  REACTION_LABEL,
  isReaction,
  decode,
  encode,
  rampFor,
  type ClientMessage,
  type ServerMessage,
} from './protocol.ts';

describe('rampFor', () => {
  it('maps each level to its ramp', () => {
    expect(rampFor('easier')).toEqual({ start: 350, step: 45 });
    expect(rampFor('normal')).toEqual({ start: 500, step: 45 });
    expect(rampFor('harder')).toEqual({ start: 750, step: 45 });
  });
  it('falls back to BATTLE_RAMP for undefined and unknown levels', () => {
    expect(rampFor()).toBe(BATTLE_RAMP);
    expect(rampFor('insane')).toBe(BATTLE_RAMP);
    expect(rampFor('toString')).toBe(BATTLE_RAMP);
  });
  it('keeps the normal ramp equal to BATTLE_RAMP', () => {
    expect(BATTLE_LEVEL_RAMP.normal).toEqual(BATTLE_RAMP);
  });
});

describe('defaults and constants', () => {
  it('default settings are the classic 3 minute normal battle', () => {
    expect(DEFAULT_BATTLE_SETTINGS).toEqual({ durationMs: BATTLE_DURATION_MS, level: 'normal' });
  });
  it('announces the settings, club, reconnect and react capabilities', () => {
    expect([...CLIENT_CAPS]).toEqual(['settings', 'club', 'reconnect', 'react']);
  });
  it('club limits', () => {
    expect(CLUB_MAX_PLAYERS).toBe(30);
    expect(CLUB_IDLE_MS).toBe(30 * 60 * 1000);
  });
});

describe('encode/decode of the new messages', () => {
  it('round-trips a club message and a challenge with settings', () => {
    const a: ClientMessage = { type: 'club-create', settings: DEFAULT_BATTLE_SETTINGS };
    expect(decode<ClientMessage>(encode(a))).toEqual(a);
    const b: ClientMessage = { type: 'challenge', code: 'ABCD', settings: { durationMs: 60_000, level: 'harder' }, series: 3 };
    expect(decode<ClientMessage>(encode(b))).toEqual(b);
  });
  it('an old hello without caps still decodes', () => {
    expect(decode<ClientMessage>('{"type":"hello","player":{"name":"A","rating":1200}}')).toMatchObject({ type: 'hello' });
  });
});

describe('reconnect', () => {
  it('holds a dropped seat for 15 seconds and both sides announce the capability', () => {
    expect(BATTLE_RECONNECT_MS).toBe(15_000);
    expect(SERVER_CAPS).toContain('reconnect');
    expect(CLIENT_CAPS).toContain('reconnect');
  });
  it('round-trips a resuming hello and the resume fields of matched', () => {
    const hello: ClientMessage = { type: 'hello', player: { name: 'A', rating: 1200 }, code: 'ABCDEF', token: 't', caps: ['reconnect'], resume: 'room-1' };
    expect(decode<ClientMessage>(encode(hello))).toEqual(hello);
    const matched: ServerMessage = {
      type: 'matched', roomId: 'room-1', seed: 1, opponent: { name: 'B', rating: 1200 },
      resume: { me: { solved: 2, strikes: 1 }, opp: { solved: 3, strikes: 0 } },
    };
    expect(decode<ServerMessage>(encode(matched))).toEqual(matched);
    expect(decode<ServerMessage>(encode({ type: 'opponent-away', graceMs: BATTLE_RECONNECT_MS }))).toEqual({ type: 'opponent-away', graceMs: 15_000 });
  });
});

describe('reactions', () => {
  it('isReaction accepts the five ids and rejects anything else', () => {
    for (const r of ['gg', 'clap', 'fire', 'wow', 'oops']) expect(isReaction(r)).toBe(true);
    for (const r of ['', 'GG', 'toString', 'lol', 1, null, undefined, {}]) expect(isReaction(r)).toBe(false);
  });
  it('has an emoji and a label for every reaction', () => {
    for (const r of REACTIONS) {
      expect(REACTION_EMOJI[r]).toBeTruthy();
      expect(REACTION_LABEL[r]).toBeTruthy();
    }
  });
  it("both cap lists include 'react'", () => {
    expect(CLIENT_CAPS).toContain('react');
    expect(SERVER_CAPS).toContain('react');
  });
});
