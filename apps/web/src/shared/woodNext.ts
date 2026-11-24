import { useLiveQuery } from 'dexie-react-hooks';
import type { Puzzle } from '@knightfall/core';
import { db, getKV, KEYS, setKV, type StoredGame } from './db.ts';

/** Puzzles picked for the NEXT Woodpecker set (a running set never changes). Ids of customPuzzles rows, oldest first. */

const MAX_PICKS = 1000;

export function cleanNextPicks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(-MAX_PICKS);
}

export async function readNextPicks(): Promise<string[]> {
  return cleanNextPicks(await getKV<unknown>(KEYS.woodNext, []));
}

/** Live picks; undefined while loading. */
export function useNextPicks(): string[] | undefined {
  return useLiveQuery(readNextPicks, []);
}

/** Pick one puzzle made from a game. It is stored with the game puzzles if it is not there yet. False = it was picked already. */
export async function addToNextSet(puzzle: Puzzle, game: StoredGame, side: 'w' | 'b'): Promise<boolean> {
  return db.transaction('rw', db.kv, db.customPuzzles, async () => {
    const picks = await readNextPicks();
    if (picks.includes(puzzle.id)) return false;
    if (!(await db.customPuzzles.get(puzzle.id))) {
      const now = Date.now();
      const author = (side === 'w' ? game.white : game.black).name;
      await db.customPuzzles.put({ ...puzzle, source: 'custom', gameUrl: game.url, createdAt: now, updatedAt: now, author, plays: 0, solves: 0 });
    }
    await setKV(KEYS.woodNext, cleanNextPicks([...picks, puzzle.id]));
    return true;
  });
}

/** The picks that went into a new set are used up. */
export async function removeNextPicks(ids: readonly string[]): Promise<void> {
  const gone = new Set(ids);
  await db.transaction('rw', db.kv, async () => setKV(KEYS.woodNext, (await readNextPicks()).filter((id) => !gone.has(id))));
}
