import { db, type CustomPuzzle } from '../../shared/db.ts';
import { getPlayerName } from '../../shared/profile.ts';
import { EXPORT_FORMAT, contentKey, newCustomId, parseImport, type PuzzleDraft } from './logic.ts';

/** IndexedDB operations for custom puzzles. */

export function draftOf(p: CustomPuzzle): PuzzleDraft {
  return { fen: p.fen, moves: p.moves, opponentFirst: p.opponentFirst, title: p.title ?? '', themes: p.themes, rating: p.rating };
}

/** Create (no id) or update (id) a puzzle. Stats survive edits unless the position/line changed. */
export async function saveCustom(d: PuzzleDraft, id?: string): Promise<CustomPuzzle> {
  const now = Date.now();
  const existing = id ? await db.customPuzzles.get(id) : undefined;
  const sameContent = existing && contentKey(existing) === contentKey(d);
  const record: CustomPuzzle = {
    id: existing?.id ?? newCustomId(),
    fen: d.fen,
    moves: d.moves,
    opponentFirst: d.opponentFirst,
    rating: d.rating,
    themes: d.themes,
    title: d.title || undefined,
    source: 'custom',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    author: existing?.author ?? (await getPlayerName()),
    plays: sameContent ? (existing?.plays ?? 0) : 0,
    solves: sameContent ? (existing?.solves ?? 0) : 0,
  };
  await db.customPuzzles.put(record);
  return record;
}

export async function deleteCustom(id: string): Promise<void> {
  await db.customPuzzles.delete(id);
}

/** Find a saved puzzle with the same position + line (for "already saved" detection). */
export async function findDuplicate(d: PuzzleDraft): Promise<CustomPuzzle | undefined> {
  const key = contentKey(d);
  const all = await db.customPuzzles.toArray();
  return all.find((p) => contentKey(p) === key);
}

/** Bump play/solve counters and log an attempt. Does not touch updatedAt (keeps list order stable). */
export async function recordPlay(p: CustomPuzzle, r: { solved: boolean; hintsUsed: number; timeMs: number }): Promise<void> {
  await db.transaction('rw', db.customPuzzles, db.attempts, async () => {
    await db.customPuzzles
      .where('id')
      .equals(p.id)
      .modify((x) => {
        x.plays = (x.plays ?? 0) + 1;
        if (r.solved) x.solves = (x.solves ?? 0) + 1;
      });
    await db.attempts.add({
      puzzleId: p.id,
      mode: 'custom',
      solved: r.solved,
      puzzleRating: p.rating,
      hintsUsed: r.hintsUsed,
      timeMs: r.timeMs,
      at: Date.now(),
    });
  });
}

/** Download every custom puzzle as a JSON file. Returns how many were exported. */
export async function exportAll(): Promise<number> {
  const puzzles = await db.customPuzzles.orderBy('createdAt').toArray();
  const body = {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    puzzles: puzzles.map((p) => ({
      id: p.id,
      title: p.title ?? '',
      fen: p.fen,
      moves: p.moves,
      opponentFirst: p.opponentFirst,
      themes: p.themes,
      rating: p.rating,
      createdAt: p.createdAt,
      plays: p.plays ?? 0,
      solves: p.solves ?? 0,
    })),
  };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `knightfall-puzzles-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return puzzles.length;
}

export interface ImportReport {
  added: number;
  duplicates: number;
  errors: string[];
}

/** Import a previously exported JSON file. Duplicates (same position + line) are skipped. */
export async function importFile(file: File): Promise<ImportReport> {
  if (file.size > 5_000_000) return { added: 0, duplicates: 0, errors: ['That file is too large (max 5 MB).'] };
  const { puzzles, errors } = parseImport(await file.text());
  if (!puzzles.length) return { added: 0, duplicates: 0, errors };
  const author = await getPlayerName();
  let added = 0;
  let duplicates = 0;
  await db.transaction('rw', db.customPuzzles, async () => {
    const existing = await db.customPuzzles.toArray();
    const keys = new Set(existing.map(contentKey));
    const ids = new Set(existing.map((p) => p.id));
    const now = Date.now();
    const rows: CustomPuzzle[] = [];
    for (const p of puzzles) {
      const key = contentKey(p);
      if (keys.has(key)) {
        duplicates++;
        continue;
      }
      keys.add(key);
      const id = p.id && !ids.has(p.id) ? p.id : newCustomId();
      ids.add(id);
      rows.push({
        id,
        fen: p.fen,
        moves: p.moves,
        opponentFirst: p.opponentFirst,
        rating: p.rating,
        themes: p.themes,
        title: p.title || undefined,
        source: 'custom',
        createdAt: p.createdAt ?? now,
        updatedAt: now + rows.length,
        author,
        plays: p.plays ?? 0,
        solves: Math.min(p.solves ?? 0, p.plays ?? 0),
      });
    }
    await db.customPuzzles.bulkPut(rows);
    added = rows.length;
  });
  return { added, duplicates, errors };
}
