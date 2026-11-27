import { describe, expect, it } from 'vitest';
import { isValidCode } from '@knightfall/core';
import { ChallengeBoard, CodeRegistry, CODE_RESERVE_MS, CODE_SWEEP_EVERY_MS, randomCode } from './challenges.ts';

const seq = (...vals: string[]) => {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
};

describe('randomCode', () => {
  it('produces valid codes', () => {
    for (let i = 0; i < 200; i++) expect(isValidCode(randomCode())).toBe(true);
  });
});

describe('CodeRegistry', () => {
  const make = (codes: string[] = ['AAAAAA', 'BBBBBB', 'CCCCCC']) => {
    let now = 1000;
    let t = 0;
    const reg = new CodeRegistry({ now: () => now, genCode: seq(...codes), genToken: () => `tok${++t}` });
    return { reg, advance: (ms: number) => (now += ms) };
  };

  it('gives a fresh code and token', () => {
    const { reg } = make();
    expect(reg.bind('s1')).toEqual({ code: 'AAAAAA', token: 'tok1' });
    expect(reg.sessionOf('AAAAAA')).toBe('s1');
    expect(reg.codeOf('s1')).toBe('AAAAAA');
  });

  it('a reconnect with code + token keeps the code', () => {
    const { reg } = make();
    const first = reg.bind('s1');
    reg.unbind('s1');
    expect(reg.sessionOf(first.code)).toBeNull();
    expect(reg.bind('s2', first.code, first.token)).toEqual(first);
    expect(reg.sessionOf(first.code)).toBe('s2');
  });

  it('a wrong token on a known code gets a fresh code', () => {
    const { reg } = make();
    const first = reg.bind('s1');
    const stolen = reg.bind('s2', first.code, 'nope');
    expect(stolen.code).not.toBe(first.code);
    expect(reg.sessionOf(first.code)).toBe('s1');
    reg.unbind('s1');
    expect(reg.bind('s3', first.code, 'nope').code).not.toBe(first.code);
  });

  it('adopts an unknown well-formed code + token (server restart)', () => {
    const { reg } = make();
    expect(reg.bind('s1', 'ZZZZZZ', 'mytoken')).toEqual({ code: 'ZZZZZZ', token: 'mytoken' });
    expect(reg.sessionOf('ZZZZZZ')).toBe('s1');
    // the adopted token now protects the code
    expect(reg.bind('s2', 'ZZZZZZ', 'other').code).not.toBe('ZZZZZZ');
  });

  it('does not adopt malformed codes or missing tokens', () => {
    const { reg } = make();
    expect(reg.bind('s1', 'ZZZZ', 'tok').code).toBe('AAAAAA');
    expect(reg.bind('s2', 'ZZZZZ0', 'tok').code).toBe('BBBBBB');
    expect(reg.bind('s3', 'ZZZZZZ').code).toBe('CCCCCC');
    expect(reg.knows('ZZZZZZ')).toBe(false);
  });

  it('fast reconnect: the same token moves a live binding to the new session', () => {
    const { reg } = make();
    const first = reg.bind('s1');
    const second = reg.bind('s2', first.code, first.token);
    expect(second).toEqual({ ...first, displaced: 's1' });
    expect(reg.sessionOf(first.code)).toBe('s2');
    expect(reg.codeOf('s1')).toBeNull();
    reg.unbind('s1'); // the old socket closing later must not unbind the new session
    expect(reg.sessionOf(first.code)).toBe('s2');
  });

  it('a session that already has a code keeps it', () => {
    const { reg } = make();
    const first = reg.bind('s1');
    expect(reg.bind('s1', 'XXXXXX', 'whatever')).toEqual(first);
  });

  it('reserves an unbound code for 24 h, then frees it', () => {
    const { reg, advance } = make(['AAAAAA', 'AAAAAA', 'BBBBBB', 'CCCCCC']);
    const first = reg.bind('s1');
    reg.unbind('s1');
    advance(CODE_RESERVE_MS - 1);
    reg.sweep();
    expect(reg.knows(first.code)).toBe(true);
    // a collision on the generator is skipped while reserved
    expect(reg.bind('s2').code).toBe('BBBBBB');
    advance(1);
    reg.sweep();
    expect(reg.knows(first.code)).toBe(false);
    // after the reservation ran out the owner's code is simply adopted again from the client's copy
    expect(reg.bind('s1', first.code, first.token).code).toBe(first.code);
  });

  it('bind and knows walk the codes at most once a minute, not on every call', () => {
    const { reg, advance } = make(['AAAAAA', 'BBBBBB', 'CCCCCC']);
    const first = reg.bind('s1');
    reg.unbind('s1');
    advance(CODE_RESERVE_MS - 1);
    reg.bind('s2'); // sweeps: the reservation has 1 ms left
    advance(1);
    expect(reg.knows(first.code)).toBe(true); // expired, but the last sweep was 1 ms ago
    advance(CODE_SWEEP_EVERY_MS);
    expect(reg.knows(first.code)).toBe(false);
  });

  it('never frees a code that is bound', () => {
    const { reg, advance } = make();
    const first = reg.bind('s1');
    advance(CODE_RESERVE_MS * 3);
    reg.sweep();
    expect(reg.sessionOf(first.code)).toBe('s1');
  });
});

describe('ChallengeBoard', () => {
  const make = (extra = {}) => {
    let now = 5000;
    let n = 0;
    const board = new ChallengeBoard({ now: () => now, genId: () => `c${++n}`, ...extra });
    return { board, advance: (ms: number) => (now += ms) };
  };

  it('creates a challenge that expires after 60 s', () => {
    const { board, advance } = make();
    const { challenge } = board.create('a', 'b');
    expect(challenge).toEqual({ id: 'c1', from: 'a', to: 'b', expiresAt: 65_000 });
    advance(59_999);
    expect(board.takeExpired()).toEqual([]);
    advance(1);
    expect(board.takeExpired()).toEqual([challenge]);
    expect(board.size).toBe(0);
  });

  it('one outgoing per sender: a new one replaces the old', () => {
    const { board } = make();
    const one = board.create('a', 'b').challenge;
    const r = board.create('a', 'c');
    expect(r.replaced).toEqual(one);
    expect(board.outgoing('a')?.to).toBe('c');
    expect(board.incoming('b')).toEqual([]);
  });

  it('keeps at most 3 incoming per target, withdrawing the oldest', () => {
    const { board } = make();
    const ids = ['a', 'b', 'c'].map((f) => board.create(f, 't').challenge.id);
    expect(board.incoming('t')).toHaveLength(3);
    const r = board.create('d', 't');
    expect(r.evicted.map((c) => c.id)).toEqual([ids[0]]);
    expect(board.incoming('t').map((c) => c.from)).toEqual(['b', 'c', 'd']);
  });

  it('rate limits to 6 attempts per sender per minute', () => {
    const { board, advance } = make();
    for (let i = 0; i < 6; i++) expect(board.allow('a')).toBe(true);
    expect(board.allow('a')).toBe(false);
    expect(board.allow('other')).toBe(true);
    advance(60_000);
    expect(board.allow('a')).toBe(true);
  });

  it('remove and get', () => {
    const { board } = make();
    const { challenge } = board.create('a', 'b');
    expect(board.get(challenge.id)).toEqual(challenge);
    expect(board.remove(challenge.id)).toEqual(challenge);
    expect(board.get(challenge.id)).toBeNull();
    expect(board.remove(challenge.id)).toBeNull();
  });
});
