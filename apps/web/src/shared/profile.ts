import { useLiveQuery } from 'dexie-react-hooks';
import type { Glicko } from '@knightfall/core';
import { db, defaults, getKV, KEYS, setKV, type StreakState } from './db.ts';

const ADJ = ['Swift', 'Silent', 'Iron', 'Clever', 'Bold', 'Lucky', 'Shadow', 'Crimson', 'Arctic', 'Golden'];
const NOUN = ['Knight', 'Bishop', 'Rook', 'Pawn', 'Gambit', 'Fork', 'Pin', 'Tempo', 'Castle', 'Zugzwang'];

export async function getPlayerName(): Promise<string> {
  let name = await getKV<string | null>(KEYS.playerName, null);
  if (!name) {
    name = `${ADJ[(Math.random() * ADJ.length) | 0]}${NOUN[(Math.random() * NOUN.length) | 0]}${(Math.random() * 90 + 10) | 0}`;
    await setKV(KEYS.playerName, name);
  }
  return name;
}

/** Live snapshot of the local player's profile; re-renders when IndexedDB changes. */
export function useProfile() {
  return useLiveQuery(async () => {
    const [puzzleRating, puzzleStreak, battleRating, name] = await Promise.all([
      getKV<Glicko>(KEYS.puzzleRating, defaults.puzzleRating),
      getKV<StreakState>(KEYS.puzzleStreak, defaults.puzzleStreak),
      getKV<number>(KEYS.battleRating, defaults.battleRating),
      // Read-only here (liveQuery can't write); main.tsx calls getPlayerName() at startup to create one.
      getKV<string>(KEYS.playerName, 'Player'),
    ]);
    return { puzzleRating, puzzleStreak, battleRating, name };
  }, []);
}

export { db };
