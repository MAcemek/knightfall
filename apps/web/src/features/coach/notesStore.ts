import { useLiveQuery } from 'dexie-react-hooks';
import { db, KEYS } from '../../shared/db.ts';
import { sanitizeLibraryTicks, toggleLibraryTick } from './libraryLogic.ts';
import { addNote, removeNote, sanitizeDailyNotes, updateNote, type DailyNote, type NotePatch } from './notesLogic.ts';

/** Daily helper notes and the ticked library entries in the local database. Every change reads and writes in one transaction. */

export async function readDailyNotes(): Promise<DailyNote[]> {
  return sanitizeDailyNotes((await db.kv.get(KEYS.dailyNotes))?.value);
}

/** Live notes. Undefined while loading. */
export function useDailyNotes(): DailyNote[] | undefined {
  return useLiveQuery(readDailyNotes, []);
}

async function changeNotes(change: (notes: DailyNote[]) => DailyNote[]): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const next = change(sanitizeDailyNotes((await db.kv.get(KEYS.dailyNotes))?.value));
    await db.kv.put({ key: KEYS.dailyNotes, value: next });
  });
}

export const addDailyNote = (now = Date.now()) => changeNotes((n) => addNote(n, now));
export const updateDailyNote = (id: string, patch: NotePatch, now = Date.now()) => changeNotes((n) => updateNote(n, id, patch, now));
export const removeDailyNote = (id: string) => changeNotes((n) => removeNote(n, id));

export async function readLibraryTicks(): Promise<string[]> {
  return sanitizeLibraryTicks((await db.kv.get(KEYS.coachLibrary))?.value);
}

/** Live ticked ids. Undefined while loading. */
export function useLibraryTicks(): string[] | undefined {
  return useLiveQuery(readLibraryTicks, []);
}

export async function toggleLibrary(id: string): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const next = toggleLibraryTick(sanitizeLibraryTicks((await db.kv.get(KEYS.coachLibrary))?.value), id);
    await db.kv.put({ key: KEYS.coachLibrary, value: next });
  });
}
