import { Chess, type Move } from 'chess.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { judgeMove, isPlayerPly, playerMoveCount, uciToMove, type Puzzle } from '@knightfall/core';
import type { BoardArrow, BoardMark } from '../Board/index.ts';
import { sfx } from '../fx/sound.ts';

export type RunnerStatus = 'idle' | 'intro' | 'player' | 'opponent' | 'solved' | 'failed' | 'solution';

export interface RunnerResult {
  puzzle: Puzzle;
  solved: boolean;
  hintsUsed: number;
  mistakes: number;
  /** Time from the solver's first turn to the result. */
  timeMs: number;
}

export interface RunnerOptions {
  /** Fires once per puzzle with the FIRST outcome (a retry after a failure does not fire again). */
  onComplete?: (r: RunnerResult) => void;
  /** Fires after every correct solver move (useful for combo effects). */
  onCorrectMove?: (info: { ply: number; square: string }) => void;
  /** Delay before the opponent replies (ms). */
  replyDelay?: number;
  /** Delay before the opponent's setup move (ms). */
  introDelay?: number;
  /** Play the solved arpeggio on completion (Rush/Battle use their own combo sounds). */
  solvedSound?: boolean;
  /**
   * After a wrong move, take it back and let the solver keep trying straight away (default true),
   * like the big puzzle sites. The puzzle still counts as failed. Rush/Battle pass false: a miss
   * is a strike and they move on to the next puzzle.
   */
  autoRetry?: boolean;
}

export interface PuzzleRunner {
  puzzle: Puzzle | null;
  fen: string;
  lastMove: [string, string] | null;
  orientation: 'white' | 'black';
  solverColor: 'w' | 'b';
  status: RunnerStatus;
  mark: BoardMark | null;
  /** Hint squares to highlight (the piece, then also its destination). */
  pulse: string[];
  /** Second hint: an arrow from the piece to its destination. */
  hintArrow: BoardArrow | null;
  shakeKey: number;
  hintsUsed: number;
  mistakes: number;
  /** The puzzle already failed once and the solver is having another go (unrated). */
  retrying: boolean;
  /** The most recent solver move was wrong (cleared by the next correct move). */
  lastWrong: boolean;
  /** Queued premove (from, to), played as soon as the opponent's move lands. */
  premove: [string, string] | null;
  /** Solver moves found / total solver moves. */
  progress: { done: number; total: number };
  /** Bumps (together with `fen`) whenever a new puzzle is loaded. Pass to <Board positionKey>. */
  positionKey: number;
  /** Bumps every time a puzzle is solved. Pass to <Board sweepKey>. */
  solvedKey: number;
  /**
   * Set while the user steps through the finished line with stepBack/stepForward:
   * the board shows the position after `index` of `total` plies (0 = starting position). Null otherwise.
   */
  review: { index: number; total: number } | null;
  playMove: (uci: string) => void;
  setPremove: (uci: string | null) => void;
  hint: () => void;
  retry: () => void;
  showSolution: () => void;
  /**
   * Step one ply back/forward through the full line. Only once the puzzle is over (status 'solved' or
   * 'solution'); board-only, nothing is reported or rated. Stops a running solution playback.
   * Returns false when stepping is not available or the end of the line is reached.
   */
  stepBack: () => boolean;
  stepForward: () => boolean;
}

const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';
/** How long a wrong move stays on the board before it is taken back. */
const WRONG_HOLD_MS = 520;
/** Gap between the opponent's move landing and a premove being played (lets the reply animate). */
const PREMOVE_GAP_MS = 70;

export function playMoveSound(m: Move) {
  if (m.isKingsideCastle() || m.isQueensideCastle()) sfx.castle();
  else if (m.isPromotion()) sfx.promote();
  else if (m.san.includes('+') || m.san.includes('#')) sfx.check();
  else if (m.isCapture() || m.isEnPassant()) sfx.capture();
  else sfx.move();
}

/**
 * Drives one puzzle: auto-plays the opponent's setup move and replies, judges solver moves
 * (accepting any checkmate), supports premoves and auto-retry, and exposes board props +
 * feedback state for <PuzzleBoard/>.
 */
export function usePuzzleRunner(puzzle: Puzzle | null, opts: RunnerOptions = {}): PuzzleRunner {
  const { replyDelay = 280, introDelay = 420, solvedSound = true, autoRetry = true } = opts;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const cfg = useRef({ replyDelay, solvedSound, autoRetry });
  cfg.current = { replyDelay, solvedSound, autoRetry };

  const puzzleRef = useRef<Puzzle | null>(puzzle);
  const chessRef = useRef<Chess | null>(null);
  const plyRef = useRef(0);
  const statusRef = useRef<RunnerStatus>('idle');
  const lastMoveRef = useRef<[string, string] | null>(null);
  const premoveRef = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reported = useRef(false);
  const startedAt = useRef(0);
  const hintsRef = useRef(0);
  const mistakesRef = useRef(0);
  const markKey = useRef(0);
  /** Ply shown while stepping through the finished line (null = not stepping). */
  const viewRef = useRef<number | null>(null);

  const [fen, setFen] = useState(puzzle?.fen ?? EMPTY_FEN);
  const [lastMove, setLastMoveState] = useState<[string, string] | null>(null);
  const [status, setStatusState] = useState<RunnerStatus>('idle');
  const [mark, setMark] = useState<BoardMark | null>(null);
  const [pulse, setPulse] = useState<string[]>([]);
  const [hintArrow, setHintArrow] = useState<BoardArrow | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [lastWrong, setLastWrong] = useState(false);
  const [premove, setPremoveState] = useState<[string, string] | null>(null);
  const [done, setDone] = useState(0);
  const [positionKey, setPositionKey] = useState(0);
  const [solvedKey, setSolvedKey] = useState(0);
  const [review, setReview] = useState<{ index: number; total: number } | null>(null);

  const setStatus = (s: RunnerStatus) => {
    statusRef.current = s;
    setStatusState(s);
  };
  const setLastMove = (m: [string, string] | null) => {
    lastMoveRef.current = m;
    setLastMoveState(m);
  };
  const clearPremove = () => {
    premoveRef.current = null;
    setPremoveState(null);
  };
  const clearHints = () => {
    setPulse([]);
    setHintArrow(null);
  };
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const solverColor: 'w' | 'b' = (() => {
    if (!puzzle) return 'w';
    const stm = (puzzle.fen.split(' ')[1] as 'w' | 'b') ?? 'w';
    return puzzle.opponentFirst ? (stm === 'w' ? 'b' : 'w') : stm;
  })();

  const report = (solved: boolean) => {
    const p = puzzleRef.current;
    if (reported.current || !p) return;
    reported.current = true;
    optsRef.current.onComplete?.({
      puzzle: p,
      solved,
      hintsUsed: hintsRef.current,
      mistakes: mistakesRef.current,
      timeMs: Date.now() - (startedAt.current || Date.now()),
    });
  };

  const applyUci = (uci: string): Move | null => {
    const c = chessRef.current!;
    try {
      const m = c.move(uciToMove(uci));
      setFen(c.fen());
      setLastMove([m.from, m.to]);
      return m;
    } catch {
      return null;
    }
  };

  /** Core move handler; reads only refs so it is safe to call from timers (premoves). */
  const handleMove = (uci: string) => {
    const p = puzzleRef.current;
    const c = chessRef.current;
    if (!p || !c || statusRef.current !== 'player') return;
    const ply = plyRef.current;
    const expected = p.moves[ply];
    const fenBefore = c.fen();
    const verdict = judgeMove(fenBefore, expected, uci);
    clearHints();

    if (verdict === 'wrong') {
      mistakesRef.current++;
      setMistakes(mistakesRef.current);
      setLastWrong(true);
      const prevLast = lastMoveRef.current;
      const m = applyUci(uci);
      if (m) playMoveSound(m);
      setMark({ square: uci.slice(2, 4), kind: 'wrong', key: ++markKey.current });
      setShakeKey((k) => k + 1);
      sfx.wrong();
      setStatus('failed');
      report(false);
      // Show the mistake briefly, take it back, then (by default) let them try again.
      later(() => {
        c.load(fenBefore);
        setFen(fenBefore);
        setLastMove(prevLast);
        setMark(null);
        if (cfg.current.autoRetry && statusRef.current === 'failed') {
          setRetrying(true);
          setStatus('player');
        }
      }, WRONG_HOLD_MS);
      return;
    }

    const m = applyUci(uci);
    if (!m) return;
    playMoveSound(m);
    setLastWrong(false);
    plyRef.current = ply + 1;
    setDone((d) => d + 1);
    const finished = verdict === 'mate' || plyRef.current >= p.moves.length;
    setMark({ square: m.to, kind: verdict === 'mate' ? 'mate' : finished ? 'best' : 'correct', key: ++markKey.current });
    optsRef.current.onCorrectMove?.({ ply, square: m.to });

    if (finished) {
      setStatus('solved');
      setSolvedKey((k) => k + 1);
      if (cfg.current.solvedSound) later(() => sfx.solved(), 90);
      report(true);
      return;
    }
    sfx.correct();
    setStatus('opponent');
    later(playOpponent, cfg.current.replyDelay);
  };

  /** Opponent reply (or setup move); then plays a queued premove if it is legal. */
  const playOpponent = () => {
    const p = puzzleRef.current;
    if (!p || !chessRef.current) return;
    setMark(null);
    const m = applyUci(p.moves[plyRef.current]);
    if (m) playMoveSound(m);
    plyRef.current++;
    if (plyRef.current >= p.moves.length) {
      setStatus('solved');
      setSolvedKey((k) => k + 1);
      report(true);
      return;
    }
    setStatus('player');
    if (!startedAt.current) startedAt.current = Date.now();

    const pm = premoveRef.current;
    clearPremove();
    if (pm) {
      const legal = chessRef.current.moves({ verbose: true }).some((x) => x.from === pm.slice(0, 2) && x.to === pm.slice(2, 4));
      if (legal) later(() => handleMove(pm), PREMOVE_GAP_MS);
    }
  };

  // Load a new puzzle
  useEffect(() => {
    puzzleRef.current = puzzle;
    clearTimers();
    reported.current = false;
    startedAt.current = 0;
    hintsRef.current = 0;
    mistakesRef.current = 0;
    setHintsUsed(0);
    setMistakes(0);
    setRetrying(false);
    setLastWrong(false);
    setMark(null);
    clearHints();
    clearPremove();
    setDone(0);
    viewRef.current = null;
    setReview(null);
    // Same batch as setFen below, so the board deals the new position instead of sliding into it.
    setPositionKey((k) => k + 1);
    if (!puzzle) {
      chessRef.current = null;
      setStatus('idle');
      return;
    }
    chessRef.current = new Chess(puzzle.fen);
    plyRef.current = 0;
    setFen(puzzle.fen);
    setLastMove(null);
    if (puzzle.opponentFirst) {
      setStatus('intro');
      later(playOpponent, introDelay);
    } else {
      setStatus('player');
      startedAt.current = Date.now();
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle]);

  const playMove = useCallback((uci: string) => handleMove(uci), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setPremove = useCallback((uci: string | null) => {
    const s = statusRef.current;
    if (!uci || (s !== 'opponent' && s !== 'intro')) {
      clearPremove();
      return;
    }
    premoveRef.current = uci;
    setPremoveState([uci.slice(0, 2), uci.slice(2, 4)]);
  }, []);

  const hint = useCallback(() => {
    const p = puzzleRef.current;
    if (!p || statusRef.current !== 'player') return;
    const expected = p.moves[plyRef.current];
    const from = expected.slice(0, 2);
    const to = expected.slice(2, 4);
    hintsRef.current++;
    setHintsUsed(hintsRef.current);
    // First hint: which piece. Second hint: an arrow to where it goes.
    if (hintsRef.current >= 2) {
      setPulse([from, to]);
      setHintArrow({ from, to, color: 'hint' });
    } else {
      setPulse([from]);
    }
  }, []);

  const retry = useCallback(() => {
    const p = puzzleRef.current;
    const c = chessRef.current;
    if (statusRef.current !== 'failed' || !p || !c) return;
    clearTimers();
    // Rebuild the position at the current ply (the wrong move may not have been taken back yet).
    const replay = new Chess(p.fen);
    for (let i = 0; i < plyRef.current; i++) replay.move(uciToMove(p.moves[i]));
    c.load(replay.fen());
    setFen(replay.fen());
    const prev = plyRef.current > 0 ? p.moves[plyRef.current - 1] : null;
    setLastMove(prev ? [prev.slice(0, 2), prev.slice(2, 4)] : null);
    setMark(null);
    setRetrying(true);
    setStatus('player');
  }, []);

  const showSolution = useCallback(() => {
    const p = puzzleRef.current;
    const s = statusRef.current;
    if (!p || s === 'solution' || s === 'solved') return;
    clearTimers();
    clearPremove();
    report(false);
    setStatus('solution');
    clearHints();
    const replay = new Chess(p.fen);
    for (let i = 0; i < plyRef.current; i++) replay.move(uciToMove(p.moves[i]));
    chessRef.current = replay;
    setFen(replay.fen());
    let step = 0;
    for (let i = plyRef.current; i < p.moves.length; i++) {
      const idx = i;
      later(() => {
        const m = applyUci(p.moves[idx]);
        if (m) {
          playMoveSound(m);
          if (isPlayerPly(p, idx)) setMark({ square: m.to, kind: 'best', key: ++markKey.current });
        }
        plyRef.current = idx + 1;
      }, 300 + step++ * 650);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Show the line after `v` plies. `dir` only picks the sound. */
  const step = (dir: 1 | -1): boolean => {
    const p = puzzleRef.current;
    const s = statusRef.current;
    if (!p || (s !== 'solved' && s !== 'solution')) return false;
    const from = viewRef.current ?? Math.min(plyRef.current, p.moves.length);
    const v = from + dir;
    if (v < 0 || v > p.moves.length) return false;
    let last: Move | null = null;
    const replay = new Chess(p.fen);
    try {
      for (let i = 0; i < v; i++) last = replay.move(uciToMove(p.moves[i]));
    } catch {
      return false;
    }
    clearTimers(); // stop a running solution playback
    viewRef.current = v;
    setFen(replay.fen());
    setLastMove(last ? [last.from, last.to] : null);
    setMark(null);
    setReview({ index: v, total: p.moves.length });
    if (dir === 1 && last) playMoveSound(last);
    else sfx.move();
    return true;
  };
  const stepBack = useCallback(() => step(-1), []); // eslint-disable-line react-hooks/exhaustive-deps
  const stepForward = useCallback(() => step(1), []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    puzzle,
    fen,
    lastMove,
    orientation: solverColor === 'w' ? 'white' : 'black',
    solverColor,
    status,
    mark,
    pulse,
    hintArrow,
    shakeKey,
    hintsUsed,
    mistakes,
    retrying,
    lastWrong,
    premove,
    progress: { done, total: puzzle ? playerMoveCount(puzzle) : 0 },
    positionKey,
    solvedKey,
    review,
    playMove,
    setPremove,
    hint,
    retry,
    showSolution,
    stepBack,
    stepForward,
  };
}
