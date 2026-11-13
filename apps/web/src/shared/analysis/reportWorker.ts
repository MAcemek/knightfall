import { buildReport, type GameReport, type OpeningTable, type ReportInput } from '@knightfall/core';

/**
 * Module Web Worker: builds the Game Review report (classification, brilliant checks, accuracy) off the main
 * thread. Started lazily by ./reportClient.ts. The opening table is not sent with each request: the worker
 * fetches /openings.json itself, once (same URL as store.loadOpenings), and caches it.
 *
 * Request:  { id: number, input: ReportRequestInput }
 * Reply:    { id, ok: true, report: GameReport }  |  { id, ok: false, error: string }
 */

export type ReportRequestInput = Omit<ReportInput, 'openings'>;

export interface ReportWorkerRequest {
  id: number;
  input: ReportRequestInput;
}

export type ReportWorkerReply = { id: number; ok: true; report: GameReport } | { id: number; ok: false; error: string };

let openingsPromise: Promise<OpeningTable | null> | null = null;

function loadOpenings(): Promise<OpeningTable | null> {
  openingsPromise ??= fetch('/openings.json')
    .then((r) => (r.ok ? (r.json() as Promise<OpeningTable>) : null))
    .catch(() => null);
  return openingsPromise;
}

self.onmessage = (e: MessageEvent<ReportWorkerRequest>) => {
  const { id, input } = e.data;
  const reply = (msg: ReportWorkerReply) => self.postMessage(msg);
  loadOpenings()
    .then((openings) => reply({ id, ok: true, report: buildReport({ ...input, openings }) }))
    .catch((err: unknown) => reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) }));
};
