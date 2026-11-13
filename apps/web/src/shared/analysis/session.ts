import { useSyncExternalStore } from 'react';
import { buildReport, parsePgnGame, type GameReport, type ParsedGame, type PositionEval } from '@knightfall/core';
import type { StoredGame } from '../db.ts';
import { analysePositions, cloudEval, ENGINES, getEnginePool, isAbortError, REVIEW_MULTIPV, type EngineId } from '../engine/index.ts';
import { getAnalysis, getAnalysisPrefs, getGame, loadOpenings, saveAnalysis } from './store.ts';

/**
 * One analysis session per game, kept in a module-level map so a review keeps running (and its result is
 * saved) when the user leaves the page and comes back. Components read it with useAnalysisSession().
 *
 * Life cycle:  loading -> (stored analysis found) done
 *              loading -> analysing -> done | error
 *              loading -> missing (no such game) | error (unreadable PGN)
 * A session starts analysing by itself when the game has no stored analysis.
 */

export type SessionStatus = 'loading' | 'analysing' | 'done' | 'error' | 'missing';

export interface SessionSnapshot {
  status: SessionStatus;
  game: StoredGame | null;
  /** The game's moves and positions (null until loaded). */
  parsed: ParsedGame | null;
  /** One slot per position (moves + 1); filled as evaluations arrive, in any order. */
  evals: readonly (PositionEval | undefined)[];
  /** Positions evaluated so far / in total. */
  done: number;
  total: number;
  /** Present when status is 'done'. */
  report: GameReport | null;
  /** Engine and depth of `report`, or of the running analysis. */
  engine: EngineId;
  depth: number;
  analysedAt: number | null;
  /** Ready-to-show message when status is 'error'. */
  error: string | null;
}

export interface AnalysisSession {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionSnapshot;
  /** (Re)analyse from scratch, optionally with another engine. Replaces the stored analysis when it finishes. */
  restart(engine?: EngineId): void;
  /** Stop a running analysis. Keeps what has been evaluated; restart() begins again. */
  cancel(): void;
}

const EMPTY: SessionSnapshot = {
  status: 'loading', game: null, parsed: null, evals: [], done: 0, total: 0, report: null, engine: 'lite', depth: ENGINES.lite.depth, analysedAt: null, error: null,
};

function createSession(gameKey: string): AnalysisSession {
  let snap = EMPTY;
  const listeners = new Set<() => void>();
  let abort: AbortController | null = null;
  let run = 0;

  const set = (patch: Partial<SessionSnapshot>) => {
    snap = { ...snap, ...patch };
    listeners.forEach((fn) => fn());
  };

  async function analyse(engine: EngineId) {
    const { game, parsed } = snap;
    if (!game || !parsed) return;
    abort?.abort();
    const ctl = new AbortController();
    abort = ctl;
    const mine = ++run;
    const depth = ENGINES[engine].depth;
    const evals: (PositionEval | undefined)[] = new Array(parsed.fens.length).fill(undefined);
    set({ status: 'analysing', evals, done: 0, total: evals.length, report: null, engine, depth, analysedAt: null, error: null });
    try {
      const pool = getEnginePool(engine);
      const [all, openings] = await Promise.all([
        analysePositions({
          fens: parsed.fens,
          depth,
          multiPv: REVIEW_MULTIPV,
          evaluate: (job) => pool.evaluate(job),
          cloud: cloudEval,
          signal: ctl.signal,
          onEval: (i, e, done, total) => {
            if (mine !== run) return;
            const next = snap.evals.slice();
            next[i] = e;
            set({ evals: next, done, total });
          },
        }),
        loadOpenings(),
      ]);
      if (mine !== run) return;
      const report = buildReport({ startFen: parsed.startFen, sans: parsed.sans, ucis: parsed.ucis, fens: parsed.fens, evals: all, openings });
      const analysedAt = Date.now();
      await saveAnalysis({ gameKey, analysedAt, engine, depth, report });
      if (mine !== run) return;
      set({ status: 'done', report, evals: all, done: all.length, analysedAt });
    } catch (e) {
      if (mine !== run || isAbortError(e)) return;
      set({ status: 'error', error: e instanceof Error ? e.message : 'The analysis failed.' });
    }
  }

  async function load() {
    try {
      const [game, stored, prefs] = await Promise.all([getGame(gameKey), getAnalysis(gameKey), getAnalysisPrefs()]);
      if (!game) return set({ status: 'missing' });
      const parsed = parsePgnGame(game.pgn);
      if (!parsed.ok) return set({ status: 'error', game, error: parsed.error });
      const total = parsed.game.fens.length;
      if (stored && stored.report.version === 1 && stored.report.evals.length === total) {
        return set({ status: 'done', game, parsed: parsed.game, report: stored.report, evals: stored.report.evals, done: total, total, engine: stored.engine, depth: stored.depth, analysedAt: stored.analysedAt });
      }
      set({ game, parsed: parsed.game, total });
      void analyse(prefs.engine);
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'The game could not be loaded.' });
    }
  }

  void load();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snap,
    restart(engine) {
      if (!snap.parsed) return;
      void analyse(engine ?? snap.engine);
    },
    cancel() {
      if (snap.status !== 'analysing') return;
      run++;
      abort?.abort();
      set({ status: 'error', error: 'Analysis stopped.' });
    },
  };
}

const sessions = new Map<string, AnalysisSession>();
/** Finished sessions are dropped beyond this many (running ones are always kept). */
const MAX_SESSIONS = 6;

export function getAnalysisSession(gameKey: string): AnalysisSession {
  let s = sessions.get(gameKey);
  if (!s) {
    for (const [key, old] of sessions) {
      if (sessions.size < MAX_SESSIONS) break;
      if (old.getSnapshot().status !== 'analysing') sessions.delete(key);
    }
    s = createSession(gameKey);
    sessions.set(gameKey, s);
  }
  return s;
}

/** Forget a session (after deleting its game). */
export function dropAnalysisSession(gameKey: string): void {
  const s = sessions.get(gameKey);
  s?.cancel();
  sessions.delete(gameKey);
}

/** React binding: the live snapshot of a game's analysis plus its controls. */
export function useAnalysisSession(gameKey: string): SessionSnapshot & Pick<AnalysisSession, 'restart' | 'cancel'> {
  const session = getAnalysisSession(gameKey);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { ...snapshot, restart: session.restart, cancel: session.cancel };
}
