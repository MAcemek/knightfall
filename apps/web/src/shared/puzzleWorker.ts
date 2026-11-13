import { rowToPuzzle, type Puzzle, type PuzzleRow } from '@knightfall/core';

/**
 * Module Web Worker: downloads one puzzle file and turns its compact rows into Puzzle objects off the
 * main thread, so loading a big bucket never blocks input. Started lazily by shared/puzzleSource.ts.
 *
 * Request:  { id: number, file: string }            file = "bucket-1200.json" | "daily-pool.json"
 * Reply:    { id, ok: true, puzzles: Puzzle[] }  |  { id, ok: false, error: string }
 */

export interface PuzzleWorkerRequest {
  id: number;
  file: string;
}

export type PuzzleWorkerReply = { id: number; ok: true; puzzles: Puzzle[] } | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<PuzzleWorkerRequest>) => {
  const { id, file } = e.data;
  const reply = (msg: PuzzleWorkerReply) => self.postMessage(msg);
  if (!/^[a-z0-9-]+\.json$/.test(file)) {
    reply({ id, ok: false, error: `Bad puzzle file name: ${file}` });
    return;
  }
  fetch(`/puzzles/${file}`)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${file}: ${r.status}`);
      return r.json() as Promise<PuzzleRow[]>;
    })
    .then((rows) => reply({ id, ok: true, puzzles: rows.map(rowToPuzzle) }))
    .catch((err: unknown) => reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) }));
};
