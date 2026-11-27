import { describe, expect, it } from 'vitest';
import { DEFAULT_BATTLE_SETTINGS } from '@knightfall/core';
import { ClubRegistry } from './club.ts';

const make = (o: { maxPlayers?: number } = {}) => {
  let now = 1_000_000;
  const reg = new ClubRegistry({ now: () => now, genCode: () => 'AAAAAA', genSeed: () => 42, countdownMs: 3000, ...o });
  return { reg, advance: (ms: number) => (now += ms) };
};
const pc = (id: string, code?: string) => ({ id, name: id.toUpperCase(), rating: 1200, ...(code ? { code } : {}) });

describe('ClubRegistry rejoin by friend code', () => {
  it('the same code on a new session takes the seat: score, reachedAt and spectator flag kept', () => {
    const t = make();
    const club = t.reg.create(pc('h', 'HHHHHH'), DEFAULT_BATTLE_SETTINGS);
    t.reg.join('AAAAAA', pc('a', 'AAA111'));
    t.reg.start('h');
    t.advance(3000);
    t.reg.tick();
    t.advance(300);
    t.reg.progress('a', { index: 0, solved: 1, strikes: 0 });
    const before = { ...club.members.get('a')! };
    t.reg.disconnect('a');
    const r = t.reg.join('AAAAAA', pc('a2', 'AAA111'));
    expect(r).toMatchObject({ ok: true, replaced: 'a' });
    expect(club.members.has('a')).toBe(false);
    expect(club.members.get('a2')).toMatchObject({ solved: 1, strikes: 0, reachedAt: before.reachedAt, spectator: false, connected: true, code: 'AAA111' });
    expect(t.reg.clubOf('a2')).toBe(club);
    expect(t.reg.clubOf('a')).toBeNull();
    expect([...club.members.keys()]).toEqual(['h', 'a2']);
  });

  it('a spectator stays a spectator', () => {
    const t = make();
    const club = t.reg.create(pc('h', 'HHHHHH'), DEFAULT_BATTLE_SETTINGS);
    t.reg.start('h');
    t.reg.join('AAAAAA', pc('late', 'LLL111'));
    t.reg.disconnect('late');
    t.reg.join('AAAAAA', pc('late2', 'LLL111'));
    expect(club.members.get('late2')).toMatchObject({ spectator: true });
  });

  it('keeps host status, and works in a full room', () => {
    const t = make({ maxPlayers: 2 });
    const club = t.reg.create(pc('h', 'HHHHHH'), DEFAULT_BATTLE_SETTINGS);
    t.reg.join('AAAAAA', pc('a', 'AAA111'));
    expect(t.reg.join('AAAAAA', pc('x', 'XXX111'))).toEqual({ ok: false, reason: 'Room is full' });
    expect(t.reg.join('AAAAAA', pc('h2', 'HHHHHH'))).toMatchObject({ ok: true, replaced: 'h' });
    expect(club.hostId).toBe('h2');
    expect(t.reg.start('h2')).toMatchObject({ ok: true });
  });

  it('a join without a code is a new member as before', () => {
    const t = make();
    const club = t.reg.create(pc('h'), DEFAULT_BATTLE_SETTINGS);
    t.reg.join('AAAAAA', pc('a'));
    expect(t.reg.join('AAAAAA', pc('a2'))).toMatchObject({ ok: true, club });
    expect(club.members.size).toBe(3);
  });

  it('the result gap and index rules apply to members', () => {
    const t = make();
    t.reg.create(pc('h'), DEFAULT_BATTLE_SETTINGS);
    t.reg.join('AAAAAA', pc('a'));
    t.reg.start('h');
    t.advance(3000);
    t.reg.tick();
    expect(t.reg.progress('a', { index: 0, solved: 1, strikes: 0 }).ok).toBe(true);
    t.advance(100);
    expect(t.reg.progress('a', { index: 1, solved: 2, strikes: 0 }).ok).toBe(false);
    t.advance(200);
    expect(t.reg.progress('a', { index: 5, solved: 2, strikes: 0 }).ok).toBe(false);
    expect(t.reg.progress('a', { index: 1, solved: 2, strikes: 0 }).ok).toBe(true);
    // A harmless repeat is still fine.
    t.advance(10);
    expect(t.reg.progress('a', { index: 0, solved: 2, strikes: 0 }).ok).toBe(true);
  });
});
