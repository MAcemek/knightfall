import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  contentKey,
  decodeShare,
  encodeShare,
  lineError,
  newCustomId,
  normalizeFen,
  parseFen,
  parseImport,
  possibleCastling,
  sanLine,
  shareUrl,
  solverSide,
  themeLabel,
  toFen,
  validateDraft,
  validatePosition,
  type PuzzleDraft,
} from './logic.ts';

// Back-rank mate: White Rd1-d8#.
const MATE_FEN = '6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1';
const draft: PuzzleDraft = {
  fen: MATE_FEN,
  moves: ['d1d8'],
  opponentFirst: false,
  title: 'Back rank — ünïcode ♞',
  themes: ['mateIn1', 'endgame'],
  rating: 900,
};

describe('position model', () => {
  it('round-trips the start position', () => {
    const r = parseFen(START_FEN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(toFen(r.position)).toBe(START_FEN);
  });

  it('accepts a placement-only FEN with defaults', () => {
    const r = parseFen('6k1/8/8/8/8/8/8/6K1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(toFen(r.position)).toBe('6k1/8/8/8/8/8/8/6K1 w - - 0 1');
  });

  it('rejects malformed FENs', () => {
    expect(parseFen('').ok).toBe(false);
    expect(parseFen('8/8/8').ok).toBe(false);
    expect(parseFen('9/8/8/8/8/8/8/8 w - - 0 1').ok).toBe(false);
    expect(parseFen('8/8/8/8/8/8/8/7X w - - 0 1').ok).toBe(false);
    expect(parseFen('8/8/8/8/8/8/8/8 x - - 0 1').ok).toBe(false);
  });

  it('drops castling rights that are not structurally possible', () => {
    expect(normalizeFen('4k3/8/8/8/8/8/8/4K2R w KQkq - 0 1')).toBe('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
    const r = parseFen(START_FEN);
    if (r.ok) expect(possibleCastling(r.position.pieces)).toEqual({ K: true, Q: true, k: true, q: true });
  });
});

describe('validatePosition', () => {
  it('accepts legal positions', () => {
    expect(validatePosition(START_FEN)).toBeNull();
    expect(validatePosition(MATE_FEN)).toBeNull();
  });

  it('requires exactly one king per side', () => {
    expect(validatePosition('8/8/8/8/8/8/8/6K1 w - - 0 1')).toMatch(/Black needs a king/);
    expect(validatePosition('6k1/8/8/8/8/8/8/8 w - - 0 1')).toMatch(/White needs a king/);
    expect(validatePosition('6k1/8/8/8/8/8/8/K5K1 w - - 0 1')).toMatch(/more than one king/);
  });

  it('rejects pawns on the back ranks', () => {
    expect(validatePosition('P5k1/8/8/8/8/8/8/6K1 w - - 0 1')).toMatch(/first or last rank/);
    expect(validatePosition('6k1/8/8/8/8/8/8/p5K1 w - - 0 1')).toMatch(/first or last rank/);
  });

  it('rejects the side not to move being in check', () => {
    // Black king on g8 attacked by the rook on g1, but it is White to move.
    expect(validatePosition('6k1/8/8/8/8/8/8/K5R1 w - - 0 1')).toMatch(/Black is in check/);
    expect(validatePosition('6k1/8/8/8/8/8/8/K5R1 b - - 0 1')).toBeNull();
  });

  it('rejects positions with no legal moves', () => {
    expect(validatePosition('3R2k1/5ppp/8/8/8/8/8/6K1 b - - 0 1')).toMatch(/checkmated/);
    expect(validatePosition('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toMatch(/stalemate/);
  });
});

describe('lines', () => {
  it('requires the line to end with a solver move', () => {
    expect(lineError([], false)).not.toBeNull();
    expect(lineError(['e2e4'], false)).toBeNull();
    expect(lineError(['e2e4', 'e7e5'], false)).not.toBeNull();
    expect(lineError(['e2e4'], true)).not.toBeNull();
    expect(lineError(['e2e4', 'e7e5'], true)).toBeNull();
  });

  it('computes the solver side', () => {
    expect(solverSide(START_FEN, false)).toBe('w');
    expect(solverSide(START_FEN, true)).toBe('b');
  });

  it('renders SAN', () => {
    expect(sanLine(MATE_FEN, ['d1d8'])).toEqual(['Rd8#']);
  });
});

describe('share links', () => {
  it('round-trips a puzzle (including unicode title)', () => {
    const enc = encodeShare(draft);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    const dec = decodeShare(enc);
    expect(dec).toEqual({ ok: true, draft });
  });

  it('round-trips an opponent-first puzzle', () => {
    const d: PuzzleDraft = { fen: START_FEN, moves: ['e2e4', 'e7e5'], opponentFirst: true, title: '', themes: [], rating: 1500 };
    const dec = decodeShare(encodeShare(d));
    expect(dec.ok).toBe(true);
    if (dec.ok) expect(dec.draft).toEqual(d);
  });

  it('builds a share URL with the hash', () => {
    expect(shareUrl('https://x.test', draft)).toMatch(/^https:\/\/x\.test\/custom\/s#[A-Za-z0-9_-]+$/);
    const hash = shareUrl('https://x.test', draft).split('#')[1];
    expect(decodeShare(`#${hash}`).ok).toBe(true);
  });

  it('rejects garbage', () => {
    expect(decodeShare('').ok).toBe(false);
    expect(decodeShare('not base64!!').ok).toBe(false);
    expect(decodeShare('AAAA').ok).toBe(false);
    expect(decodeShare(btoa('[1,2,3]')).ok).toBe(false);
  });

  it('rejects illegal content', () => {
    const enc = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeShare(enc({ f: MATE_FEN, m: 'd1d7', o: 0 }))).toEqual({ ok: true, draft: expect.anything() });
    expect(decodeShare(enc({ f: MATE_FEN, m: 'd1h5', o: 0 })).ok).toBe(false); // illegal move
    expect(decodeShare(enc({ f: MATE_FEN, m: 'd1d7 g8f8', o: 0 })).ok).toBe(false); // ends with opponent
    expect(decodeShare(enc({ f: '8/8/8/8/8/8/8/8 w - - 0 1', m: 'd1d8', o: 0 })).ok).toBe(false); // no kings
    expect(decodeShare(enc({ f: MATE_FEN, m: 'zz', o: 0 })).ok).toBe(false);
    expect(decodeShare(enc({ f: 42, m: 'd1d8', o: 0 })).ok).toBe(false);
  });

  it('clamps rating and sanitizes themes', () => {
    const r = validateDraft({ fen: MATE_FEN, moves: 'd1d8', opponentFirst: 0, themes: ['  fork ', 'fork', 3, ''], rating: 9999 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.rating).toBe(2800);
      expect(r.draft.themes).toEqual(['fork']);
    }
  });
});

describe('import', () => {
  it('parses the export envelope and reports invalid rows', () => {
    const text = JSON.stringify({
      format: 'knightfall-custom-puzzles',
      puzzles: [
        { ...draft, id: 'c_abc123def0', plays: 3, solves: 2 },
        { fen: 'garbage', moves: ['e2e4'], opponentFirst: false },
        'nope',
      ],
    });
    const r = parseImport(text);
    expect(r.puzzles).toHaveLength(1);
    expect(r.puzzles[0]).toMatchObject({ id: 'c_abc123def0', plays: 3, solves: 2, moves: ['d1d8'] });
    expect(r.errors).toHaveLength(2);
  });

  it('accepts a bare array and rejects non-JSON', () => {
    expect(parseImport(JSON.stringify([draft])).puzzles).toHaveLength(1);
    expect(parseImport('{').errors[0]).toMatch(/not valid JSON/);
    expect(parseImport('{"a":1}').errors[0]).toMatch(/No puzzles/);
  });
});

describe('misc', () => {
  it('generates prefixed ids', () => {
    const id = newCustomId();
    expect(id).toMatch(/^c_[a-z0-9]{10}$/);
    expect(newCustomId()).not.toBe(id);
  });

  it('labels themes', () => {
    expect(themeLabel('discoveredAttack')).toBe('Discovered attack');
    expect(themeLabel('mateIn2')).toBe('Mate in 2');
    expect(themeLabel('backRank')).toBe('Back rank');
    expect(themeLabel('my idea')).toBe('My idea');
  });

  it('content key ignores move counters', () => {
    expect(contentKey({ ...draft, fen: MATE_FEN.replace('0 1', '5 30') })).toBe(contentKey(draft));
  });
});
