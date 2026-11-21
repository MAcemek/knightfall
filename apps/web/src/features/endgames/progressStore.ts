import { useLiveQuery } from 'dexie-react-hooks';
import { getKV, KEYS, setKV } from '../../shared/db.ts';
import { recordSolve, sanitizeProgress, type EndgameProgress } from './endgameLogic.ts';

const readProgress = async () => sanitizeProgress(await getKV<unknown>(KEYS.endgameProgress, {}));

/** Solved drills, live. Undefined until the first read finishes. */
export function useEndgameProgress(): EndgameProgress | undefined {
  return useLiveQuery(readProgress, []);
}

export async function saveSolve(id: string, moves: number): Promise<void> {
  await setKV(KEYS.endgameProgress, recordSolve(await readProgress(), id, moves));
}
