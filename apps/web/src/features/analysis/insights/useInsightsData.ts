import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { parsePgnGame, REPORT_VERSION } from '@knightfall/core';
import { db, type StoredAnalysis, type StoredGame } from '../../../shared/db.ts';
import { saveAnalysis, useAnalysisPrefs } from '../../../shared/analysis/index.ts';
import { buildReportOffThread } from '../../../shared/analysis/reportClient.ts';
import { buildInsights, staleKeys, type InsightsData } from './insightsLogic.ts';

interface Row {
  game: StoredGame;
  analysis: StoredAnalysis;
}

export interface InsightsState {
  /** Undefined while loading. */
  data: InsightsData | undefined;
  /** Reviews found in total (including ones that are skipped). */
  reviews: number;
  /** Set while old reviews are being rebuilt in the worker. */
  updating: { done: number; total: number } | null;
}

/**
 * Every stored review joined with its game, plus the one-at-a-time rebuild of reports older than
 * REPORT_VERSION (they are rebuilt from their stored evaluations in the report worker and saved back).
 */
export function useInsightsData(): InsightsState {
  const prefs = useAnalysisPrefs();
  const rows = useLiveQuery<Row[]>(async () => {
    const analyses = await db.analyses.toArray();
    const games = await db.games.bulkGet(analyses.map((a) => a.gameKey));
    return analyses.flatMap((analysis, i) => (games[i] ? [{ game: games[i]!, analysis }] : []));
  }, []);

  const failed = useRef(new Set<string>());
  const batch = useRef({ total: 0, done: 0 });
  const [tick, setTick] = useState(0);

  const stale = useMemo(() => (rows ? staleKeys(rows.map((r) => ({ gameKey: r.analysis.gameKey, report: r.analysis.report })), REPORT_VERSION).filter((k) => !failed.current.has(k)) : []), [rows, tick]);
  const next = stale[0];

  useEffect(() => {
    if (!rows) return;
    if (!next) {
      batch.current = { total: 0, done: 0 };
      return;
    }
    if (batch.current.total === 0) batch.current = { total: stale.length, done: 0 };
    const row = rows.find((r) => r.analysis.gameKey === next);
    if (!row) return;
    let live = true;
    (async () => {
      try {
        const parsed = parsePgnGame(row.game.pgn);
        if (!parsed.ok || parsed.game.fens.length !== row.analysis.report.evals.length) throw new Error('cannot rebuild');
        const g = parsed.game;
        const report = await buildReportOffThread({ startFen: g.startFen, sans: g.sans, ucis: g.ucis, fens: g.fens, evals: row.analysis.report.evals, ratings: { white: row.game.white.rating, black: row.game.black.rating } });
        await saveAnalysis({ ...row.analysis, report });
      } catch {
        failed.current.add(next);
      }
      batch.current.done++;
      // A successful save re-runs the live query; a failure needs a nudge to move on to the next review.
      if (live) setTick((t) => t + 1);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, rows === undefined]);

  const data = useMemo(() => {
    if (!rows || !prefs) return undefined;
    return buildInsights(
      rows.map((r) => ({ game: r.game, report: r.analysis.report })),
      { lichessUser: prefs.lichessUser, chesscomUser: prefs.chesscomUser },
      REPORT_VERSION,
    );
  }, [rows, prefs]);

  return {
    data,
    reviews: rows?.length ?? 0,
    updating: next ? { done: batch.current.done, total: Math.max(batch.current.total, batch.current.done + stale.length) } : null,
  };
}
