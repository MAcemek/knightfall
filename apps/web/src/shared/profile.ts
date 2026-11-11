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

/** Normalise a display name: trimmed, single spaces, max 20 chars. Returns null when nothing usable is left. */
export function cleanPlayerName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 20).trim();
  return name.length >= 2 ? name : null;
}

/** Rename the local player. Returns the stored name, or null when `raw` is not a usable name. */
export async function setPlayerName(raw: string): Promise<string | null> {
  const name = cleanPlayerName(raw);
  if (!name) return null;
  await setKV(KEYS.playerName, name);
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
