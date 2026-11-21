import { describe, expect, it } from 'vitest';
import {
  BATTLE_DURATION_MS,
  BATTLE_LEVEL_RAMP,
  BATTLE_RAMP,
  CLIENT_CAPS,
  CLUB_IDLE_MS,
  CLUB_MAX_PLAYERS,
  DEFAULT_BATTLE_SETTINGS,
  decode,
  encode,
  rampFor,
  type ClientMessage,
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
  it('announces the settings and club capabilities', () => {
    expect([...CLIENT_CAPS]).toEqual(['settings', 'club']);
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
