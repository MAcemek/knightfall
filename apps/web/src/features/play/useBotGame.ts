import { useCallback, useEffect, useRef, useState } from 'react';
import { db, getKV, KEYS, setKV } from '../../shared/db.ts';
import { saveGames } from '../../shared/analysis/index.ts';
import { BotEngine } from '../../shared/engine/botEngine.ts';
import { ENGINES } from '../../shared/engine/engines.ts';
import { isAbortError } from '../../shared/engine/pool.ts';
import { workerTransport } from '../../shared/engine/uci.ts';
import { playMoveSound } from '../../shared/PuzzlePlayer/index.ts';
import { getPlayerName } from '../../shared/profile.ts';
import {
  allTicked, applyMove, botMoveContext, botSide, clockNow, flagged, latestRapidRating, NO_TICKS, pause, previewMove, recordCheck, resign,
  resume, sanitizeBotGame, START_FEN, startGame, thinkMs, timeOut, toggleTick, toSaved, toStoredGame, turnOf,
  type BotGame, type CheckId, type Side, type Ticks,
} from './playLogic.ts';

export type EngineState = 'idle' | 'loading' | 'ready' | 'failed';
export type SaveState = 'idle' | 'saving' | 'done' | 'failed';

/** A move the player has made on the board and not yet confirmed. */
export interface Held {
  uci: string;
  san: string;
  /** Half-moves played when it was made. */
  ply: number;
  ticks: Ticks;
}

export interface NewGameOptions {
  base: number;
  inc: number;
  you: Side;
  elo: number;
}

const SEARCH_MS = 700;
const SAVE_EVERY_MS = 5000;
const TICK_MS = 200;

/**
 * Everything one bot game needs: the saved game, the engine, the clocks, the held move and the bot's turn.
 * The state lives in `gameRef` (always current) and is mirrored into React state for drawing; callbacks read
 * the ref so they never act on a stale game.
 */
export function useBotGame() {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<BotGame | null>(null);
  const [game, setGame] = useState<BotGame | null>(null);
  const [held, setHeldState] = useState<Held | null>(null);
  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [botError, setBotError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [engineKey, setEngineKey] = useState(0);
  const [saveTry, setSaveTry] = useState(0);

  const gameRef = useRef<BotGame | null>(null);
  const heldRef = useRef<Held | null>(null);
  const engineRef = useRef<BotEngine | null>(null);
  /** The player asked for this game to run (Start, Continue or Try again). Until then it stays paused. */
  const wantRun = useRef(false);
  const finishedRef = useRef<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const setHeld = useCallback((h: Held | null) => {
    heldRef.current = h;
    setHeldState(h);
  }, []);

  /** Run a storage task after every earlier one, so a late save can never undo a later clear. */
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  const persist = useCallback(() => {
    void enqueue(async () => {
      const g = gameRef.current;
      if (!g || g.status === 'over') return;
      await setKV(KEYS.botGame, toSaved(g, Date.now()));
    }).catch(() => undefined);
  }, [enqueue]);

  const commit = useCallback(
    (next: BotGame | null) => {
      const prev = gameRef.current;
      gameRef.current = next;
      setGame(next);
      if (next && next.status !== 'over' && (!prev || prev.id !== next.id || prev.moves.length !== next.moves.length)) persist();
    },
    [persist],
  );

  /* ---------- saved game ---------- */

  useEffect(() => {
    let cancelled = false;
    void getKV<unknown>(KEYS.botGame, null)
      .then((raw) => {
        if (cancelled) return;
        setSaved(sanitizeBotGame(raw));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- engine ---------- */

  const active = game !== null && game.status !== 'over';
  const gameId = game?.id ?? null;
  const elo = game?.elo ?? 0;

  useEffect(() => {
    if (!active) {
      setEngineState('idle');
      return;
    }
    let dead = false;
    let engine: BotEngine;
    try {
      engine = new BotEngine(workerTransport(ENGINES.lite.url), elo);
    } catch {
      setEngineState('failed');
      return;
    }
    engineRef.current = engine;
    setEngineState('loading');
    engine.ready().then(
      () => {
        if (!dead) setEngineState('ready');
      },
      () => {
        if (!dead) setEngineState('failed');
      },
    );
    return () => {
      dead = true;
      engine.terminate();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // The level is fixed for a game, so `elo` only changes together with `gameId`.
  }, [active, gameId, elo, engineKey]);

  /* ---------- clocks start when the engine is ready ---------- */

  const status = game?.status ?? null;
  useEffect(() => {
    const g = gameRef.current;
    if (engineState !== 'ready' || !g || g.status !== 'paused' || !wantRun.current || botError) return;
    commit(resume(g, Date.now()));
  }, [engineState, status, gameId, botError, commit]);

  /* ---------- the running clock and flagging ---------- */

  useEffect(() => {
    if (status !== 'playing') return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const g = gameRef.current;
      if (!g) return;
      const side = flagged(g, t);
      if (side) {
        setHeld(null);
        commit(timeOut(g, side));
      }
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [status, gameId, commit, setHeld]);

  /* ---------- the bot's turn ---------- */

  const botTurn = game !== null && game.status === 'playing' && turnOf(game) !== game.you;
  const plies = game?.moves.length ?? 0;
  useEffect(() => {
    if (!botTurn || engineState !== 'ready') return;
    const engine = engineRef.current;
    const g0 = gameRef.current;
    if (!engine || !g0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctx = botMoveContext(g0);
    const wait = thinkMs({
      clockMs: clockNow(g0, botSide(g0), Date.now()),
      incMs: g0.inc,
      legalMoves: ctx.legalMoves,
      ply: ctx.ply,
      recapture: ctx.recapture,
      rand: Math.random(),
    });
    const thought = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, wait);
    });
    const fail = (message: string) => {
      const g = gameRef.current;
      if (g) commit(pause(g, Date.now()));
      setBotError(message);
    };
    engine
      .bestMove(START_FEN, g0.moves.map((m) => m.uci), { moveTimeMs: SEARCH_MS })
      .then(async (uci) => {
        await thought;
        if (cancelled) return;
        const g = gameRef.current;
        if (!g) return;
        const r = applyMove(g, uci, Date.now());
        if (r.kind === 'illegal') {
          fail('The engine sent a move that is not legal.');
          return;
        }
        if (r.kind === 'moved') playMoveSound(r.move);
        commit(r.state);
      })
      .catch((e: unknown) => {
        if (cancelled || isAbortError(e)) return;
        fail('The engine stopped working.');
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      engine.stop();
    };
  }, [botTurn, plies, gameId, engineState, commit]);

  /* ---------- saving while playing ---------- */

  useEffect(() => {
    if (!active) return;
    const id = setInterval(persist, SAVE_EVERY_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [active, persist]);

  // Leaving the page pauses the game and keeps it.
  useEffect(
    () => () => {
      const g = gameRef.current;
      if (g && g.status === 'playing') gameRef.current = pause(g, Date.now());
      persist();
    },
    [persist],
  );

  /* ---------- game over ---------- */

  useEffect(() => {
    if (!game || game.status !== 'over' || finishedRef.current === game.id) return;
    finishedRef.current = game.id;
    const over = game;
    setSaveState('saving');
    void enqueue(async () => {
      const [name, rows] = await Promise.all([getPlayerName(), db.ratingLog.toArray()]);
      const stored = toStoredGame(over, name, latestRapidRating(rows), Date.now());
      // Store first, then clear: if storing fails the saved game is still there.
      if (stored) await saveGames([stored]);
      await setKV(KEYS.botGame, null);
      return stored?.key ?? null;
    }).then(
      (key) => {
        setStoredKey(key);
        setSaveState('done');
      },
      () => {
        finishedRef.current = null;
        setSaveState('failed');
      },
    );
  }, [game, saveTry, enqueue]);

  /* ---------- actions ---------- */

  const start = useCallback(
    (o: NewGameOptions) => {
      const g = startGame({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, now: Date.now(), ...o });
      wantRun.current = true;
      finishedRef.current = null;
      setHeld(null);
      setBotError(null);
      setStoredKey(null);
      setSaveState('idle');
      setEngineState('loading');
      // Starting replaces the saved game, so the lobby must not offer it again.
      setSaved(null);
      commit(g);
    },
    [commit, setHeld],
  );

  const continueSaved = useCallback(() => {
    const g = saved;
    if (!g) return;
    wantRun.current = true;
    finishedRef.current = null;
    setHeld(null);
    setBotError(null);
    setStoredKey(null);
    setSaveState('idle');
    setEngineState('loading');
    setSaved(null);
    commit(g);
  }, [saved, commit, setHeld]);

  const discardSaved = useCallback(() => {
    setSaved(null);
    void enqueue(() => setKV(KEYS.botGame, null)).catch(() => undefined);
  }, [enqueue]);

  /** Back to the lobby after a finished game. */
  const leave = useCallback(() => {
    wantRun.current = false;
    setHeld(null);
    setBotError(null);
    setStoredKey(null);
    setSaveState('idle');
    commit(null);
  }, [commit, setHeld]);

  /** The engine failed or did not start: build a new one and go on from where the clocks stopped. */
  const retryEngine = useCallback(() => {
    wantRun.current = true;
    setBotError(null);
    setEngineState('loading');
    setEngineKey((k) => k + 1);
  }, []);

  const retrySave = useCallback(() => setSaveTry((k) => k + 1), []);

  const makeMove = useCallback(
    (uci: string) => {
      const g = gameRef.current;
      if (!g || g.status !== 'playing' || turnOf(g) !== g.you || heldRef.current) return;
      const p = previewMove(g, uci);
      if (!p) return;
      playMoveSound(p.move);
      setHeld({ uci: p.move.lan, san: p.move.san, ply: g.moves.length, ticks: NO_TICKS });
    },
    [setHeld],
  );

  const toggle = useCallback(
    (id: CheckId) => {
      const h = heldRef.current;
      if (h) setHeld({ ...h, ticks: toggleTick(h.ticks, id) });
    },
    [setHeld],
  );

  const confirm = useCallback(() => {
    const h = heldRef.current;
    const g = gameRef.current;
    if (!h || !g || !allTicked(h.ticks)) return;
    setHeld(null);
    const r = applyMove(g, h.uci, Date.now());
    if (r.kind === 'moved') commit(recordCheck(r.state, 'shown'));
    else if (r.kind === 'flagged') commit(r.state);
  }, [commit, setHeld]);

  const takeBack = useCallback(() => {
    const h = heldRef.current;
    const g = gameRef.current;
    if (!h || !g) return;
    setHeld(null);
    commit(recordCheck(g, 'changed'));
  }, [commit, setHeld]);

  const resignNow = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.status === 'over') return;
    setHeld(null);
    commit(resign(g, Date.now()));
  }, [commit, setHeld]);

  // A held move only belongs to the position it was made in.
  const activeHeld = held && game && game.status === 'playing' && held.ply === game.moves.length && turnOf(game) === game.you ? held : null;

  return {
    loaded,
    saved,
    game,
    held: activeHeld,
    engineState,
    botError,
    saveState,
    storedKey,
    now,
    start,
    continueSaved,
    discardSaved,
    leave,
    retryEngine,
    retrySave,
    makeMove,
    toggle,
    confirm,
    takeBack,
    resignNow,
  };
}

export type BotGameApi = ReturnType<typeof useBotGame>;
