import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameReport } from '@knightfall/core';

vi.mock('@knightfall/core', () => ({
  buildReport: vi.fn((input: { sans: string[]; openings: unknown }) => ({ fake: 'main', n: input.sans.length, openings: input.openings }) as unknown as GameReport),
}));

import { buildReport } from '@knightfall/core';
import { __resetReportClientForTests, buildReportOffThread, type ReportWorkerLike } from './reportClient.ts';
import type { ReportWorkerReply, ReportWorkerRequest } from './reportWorker.ts';

const input = (sans: string[]) => ({ startFen: 'start', sans, ucis: sans, fens: ['a'], evals: [] });

class FakeWorker implements ReportWorkerLike {
  onmessage: ReportWorkerLike['onmessage'] = null;
  onerror: ReportWorkerLike['onerror'] = null;
  sent: ReportWorkerRequest[] = [];
  terminated = false;
  postMessage(m: ReportWorkerRequest) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(r: ReportWorkerReply) {
    this.onmessage?.({ data: r } as MessageEvent<ReportWorkerReply>);
  }
}

beforeEach(() => {
  vi.mocked(buildReport).mockClear();
});

describe('buildReportOffThread', () => {
  it('falls back to the main thread when no Worker is available', async () => {
    __resetReportClientForTests({ createWorker: () => null, loadOpenings: async () => ({ o: 1 }) as never });
    const r = (await buildReportOffThread(input(['e4']))) as unknown as { fake: string; n: number; openings: unknown };
    expect(r).toMatchObject({ fake: 'main', n: 1, openings: { o: 1 } });
  });

  it('matches replies to requests by id, even out of order', async () => {
    const w = new FakeWorker();
    __resetReportClientForTests({ createWorker: () => w });
    const p1 = buildReportOffThread(input(['e4']));
    const p2 = buildReportOffThread(input(['d4']));
    expect(w.sent.map((m) => m.id)).toEqual([1, 2]);
    w.reply({ id: 2, ok: true, report: { tag: 'second' } as unknown as GameReport });
    w.reply({ id: 1, ok: true, report: { tag: 'first' } as unknown as GameReport });
    expect(await p1).toEqual({ tag: 'first' });
    expect(await p2).toEqual({ tag: 'second' });
    expect(buildReport).not.toHaveBeenCalled();
  });

  it('ignores replies with unknown ids', async () => {
    const w = new FakeWorker();
    __resetReportClientForTests({ createWorker: () => w });
    const p = buildReportOffThread(input(['e4']));
    w.reply({ id: 99, ok: true, report: {} as GameReport });
    w.reply({ id: 1, ok: true, report: { tag: 'ok' } as unknown as GameReport });
    expect(await p).toEqual({ tag: 'ok' });
  });

  it('falls back to the main thread when the worker replies with an error', async () => {
    const w = new FakeWorker();
    __resetReportClientForTests({ createWorker: () => w });
    const p = buildReportOffThread(input(['e4']));
    w.reply({ id: 1, ok: false, error: 'boom' });
    expect(await p).toMatchObject({ fake: 'main' });
  });

  it('on a worker crash, falls back for pending calls, terminates it, and stops using it', async () => {
    const w = new FakeWorker();
    __resetReportClientForTests({ createWorker: () => w });
    const p = buildReportOffThread(input(['e4']));
    w.onerror?.(new Error('crash'));
    expect(await p).toMatchObject({ fake: 'main' });
    expect(w.terminated).toBe(true);
    expect(await buildReportOffThread(input(['d4']))).toMatchObject({ fake: 'main', n: 1 });
    expect(w.sent).toHaveLength(1);
  });

  it('falls back when the worker cannot be created', async () => {
    __resetReportClientForTests({
      createWorker: () => {
        throw new Error('no worker');
      },
    });
    expect(await buildReportOffThread(input(['e4']))).toMatchObject({ fake: 'main' });
  });
});
