import { describe, expect, it } from 'vitest';
import { entriesOf, LIBRARY, sanitizeLibraryTicks, toggleLibraryTick } from './libraryLogic.ts';

describe('LIBRARY', () => {
  it('has unique ids and every group', () => {
    expect(new Set(LIBRARY.map((e) => e.id)).size).toBe(LIBRARY.length);
    expect(entriesOf('videos')).toHaveLength(8);
    expect(entriesOf('books')).toHaveLength(7);
    expect(entriesOf('tools')).toHaveLength(13);
  });
  it('uses https links only, without prices in the text', () => {
    for (const e of LIBRARY) {
      expect(e.url).toMatch(/^https:\/\//);
      expect(e.title.length).toBeGreaterThan(0);
      expect(`${e.title} ${e.note}`).not.toMatch(/[$€£]|\bfree trial\b/i);
    }
  });
  it('links books to Open Library searches for their own title', () => {
    for (const e of entriesOf('books')) {
      const url = new URL(e.url);
      expect(url.origin).toBe('https://openlibrary.org');
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('q')).toBe(e.title);
    }
  });
  // Each handle was opened and its channel name and description checked. @EricRosen, for example, is someone else.
  it('links every video entry to the right channel', () => {
    expect(Object.fromEntries(entriesOf('videos').map((e) => [e.title, e.url.replace('https://www.youtube.com/', '')]))).toEqual({
      'Daniel Naroditsky speedruns': '@DanielNaroditskyGM',
      'John Bartholomew': '@JohnBartholomewChess',
      'Hanging Pawns': '@HangingPawns',
      'Saint Louis Chess Club': '@STLChessClub',
      GothamChess: '@GothamChess',
      ChessNetwork: '@ChessNetwork',
      'Chess Vibes': '@ChessVibesOfficial',
      'Eric Rosen': '@eric-rosen',
    });
  });
  it('does not use dashes or exclamation marks in its copy', () => {
    for (const e of LIBRARY) expect(`${e.title} ${e.note}`).not.toMatch(/[\u2014!]/);
  });
});

describe('library ticks', () => {
  it('keeps known ids once, in library order', () => {
    expect(sanitizeLibraryTicks(['t-chessable', 'v-naroditsky', 'nope', 5, 'v-naroditsky'])).toEqual(['v-naroditsky', 't-chessable']);
    expect(sanitizeLibraryTicks('x')).toEqual([]);
    expect(sanitizeLibraryTicks(null)).toEqual([]);
  });
  it('toggles', () => {
    expect(toggleLibraryTick([], 'b-woodpecker')).toEqual(['b-woodpecker']);
    expect(toggleLibraryTick(['b-woodpecker'], 'b-woodpecker')).toEqual([]);
    expect(toggleLibraryTick(['b-woodpecker'], 'unknown')).toEqual(['b-woodpecker']);
  });
});
