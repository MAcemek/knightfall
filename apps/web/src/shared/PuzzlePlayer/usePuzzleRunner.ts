import { Chess, type Move } from 'chess.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { judgeMove, isPlayerPly, playerMoveCount, uciToMove, type Puzzle } from '@knightfall/core';
import type { BoardMark } from '../Board/index.ts';
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
}

export interface PuzzleRunner {
  puzzle: Puzzle | null;
  fen: string;
  lastMove: [string, string] | null;
  orientation: 'white' | 'black';
  solverColor: 'w' | 'b';
  status: RunnerStatus;
  mark: BoardMark | null;
  pulse: string[];
  shakeKey: number;
  hintsUsed: number;
  mistakes: number;
  retrying: boolean;
  /** Solver moves found / total solver moves. */
  progress: { done: number; total: number };
  playMove: (uci: string) => void;
  hint: () => void;
  retry: () => void;
  showSolution: () => void;
}

const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

export function playMoveSound(m: Move) {
  if (m.isKingsideCastle() || m.isQueensideCastle()) sfx.castle();
  else if (m.isPromotion()) sfx.promote();
  else if (m.san.includes('+') || m.san.includes('#')) sfx.check();
  else if (m.isCapture() || m.isEnPassant()) sfx.capture();
  else sfx.move();
}

/**
 * Drives one puzzle: auto-plays the opponent's setup move and replies, judges solver moves
 * (accepting any checkmate), and exposes board props + feedback state for <PuzzleBoard/>.
 */
export function usePuzzleRunner(puzzle: Puzzle | null, opts: RunnerOptions = {}): PuzzleRunner {
  const { replyDelay = 420, introDelay = 550, solvedSound = true } = opts;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const chessRef = useRef<Chess | null>(null);
  const plyRef = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reported = useRef(false);
  const startedAt = useRef(0);
  const hintsRef = useRef(0);
  const mistakesRef = useRef(0);
  const markKey = useRef(0);

  const [fen, setFen] = useState(puzzle?.fen ?? EMPTY_FEN);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [status, setStatus] = useState<RunnerStatus>('idle');
  const [mark, setMark] = useState<BoardMark | null>(null);
  const [pulse, setPulse] = useState<string[]>([]);
  const [shakeKey, setShakeKey] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [done, setDone] = useState(0);

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

  const report = useCallback(
    (solved: boolean) => {
      if (reported.current || !puzzle) return;
      reported.current = true;
      optsRef.current.onComplete?.({
        puzzle,
        solved,
        hintsUsed: hintsRef.current,
        mistakes: mistakesRef.current,
        timeMs: Date.now() - startedAt.current,
      });
    },
    [puzzle],
  );

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

  const playOpponent = useCallback(() => {
    if (!puzzle) return;
    setMark(null);
    const m = applyUci(puzzle.moves[plyRef.current]);
    if (m) playMoveSound(m);
    plyRef.current++;
    if (plyRef.current >= puzzle.moves.length) {
      setStatus('solved');
      report(true);
      return;
    }
    setStatus('player');
    if (!startedAt.current) startedAt.current = Date.now();
  }, [puzzle, report]);

  // Load a new puzzle
  useEffect(() => {
    clearTimers();
    reported.current = false;
    startedAt.current = 0;
    hintsRef.current = 0;
    mistakesRef.current = 0;
    setHintsUsed(0);
    setMistakes(0);
    setRetrying(false);
    setMark(null);
    setPulse([]);
    setDone(0);
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

  const playMove = useCallback(
    (uci: string) => {
      if (!puzzle || status !== 'player' || !chessRef.current) return;
      const c = chessRef.current;
      const ply = plyRef.current;
      const expected = puzzle.moves[ply];
      const fenBefore = c.fen();
      const verdict = judgeMove(fenBefore, expected, uci);
      setPulse([]);

      if (verdict === 'wrong') {
        mistakesRef.current++;
        setMistakes(mistakesRef.current);
        const prevLast = lastMove;
        const m = applyUci(uci);
        if (m) playMoveSound(m);
        setMark({ square: uci.slice(2, 4), kind: 'wrong', key: ++markKey.current });
        setShakeKey((k) => k + 1);
        sfx.wrong();
        setStatus('failed');
        report(false);
        // Show the mistake briefly, then take it back.
        later(() => {
          c.load(fenBefore);
          setFen(fenBefore);
          setLastMove(prevLast);
          setMark(null);
        }, 650);
        return;
      }

      const m = applyUci(uci);
      if (!m) return;
      playMoveSound(m);
      plyRef.current = ply + 1;
      setDone((d) => d + 1);
      const finished = verdict === 'mate' || plyRef.current >= puzzle.moves.length;
      setMark({ square: m.to, kind: verdict === 'mate' ? 'mate' : finished ? 'best' : 'correct', key: ++markKey.current });
      optsRef.current.onCorrectMove?.({ ply, square: m.to });

      if (finished) {
        setStatus('solved');
        if (solvedSound) later(() => sfx.solved(), 90);
        report(true);
        return;
      }
      sfx.correct();
      setStatus('opponent');
      later(playOpponent, replyDelay);
    },
    [puzzle, status, lastMove, report, playOpponent, replyDelay, solvedSound],
  );

  const hint = useCallback(() => {
    if (!puzzle || status !== 'player') return;
    const expected = puzzle.moves[plyRef.current];
    hintsRef.current++;
    setHintsUsed(hintsRef.current);
    // First hint: which piece. Second hint: where it goes.
    setPulse(hintsRef.current >= 2 ? [expected.slice(0, 2), expected.slice(2, 4)] : [expected.slice(0, 2)]);
    sfx.click();
  }, [puzzle, status]);

  const retry = useCallback(() => {
    if (status !== 'failed') return;
    clearTimers();
    // Ensure the wrong move is reverted even if the take-back timer was cleared.
    const c = chessRef.current;
    if (c && puzzle) {
      const replay = new Chess(puzzle.fen);
      for (let i = 0; i < plyRef.current; i++) replay.move(uciToMove(puzzle.moves[i]));
      c.load(replay.fen());
      setFen(replay.fen());
      const prev = plyRef.current > 0 ? puzzle.moves[plyRef.current - 1] : null;
      setLastMove(prev ? [prev.slice(0, 2), prev.slice(2, 4)] : null);
    }
    setMark(null);
    setRetrying(true);
    setStatus('player');
  }, [status, puzzle]);

  const showSolution = useCallback(() => {
    if (!puzzle || status === 'solution' || status === 'solved') return;
    clearTimers();
    report(false);
    setStatus('solution');
    setPulse([]);
    const replay = new Chess(puzzle.fen);
    for (let i = 0; i < plyRef.current; i++) replay.move(uciToMove(puzzle.moves[i]));
    chessRef.current = replay;
    setFen(replay.fen());
    let step = 0;
    for (let i = plyRef.current; i < puzzle.moves.length; i++) {
      const idx = i;
      later(() => {
        const m = applyUci(puzzle.moves[idx]);
        if (m) {
          playMoveSound(m);
          if (isPlayerPly(puzzle, idx)) setMark({ square: m.to, kind: 'best', key: ++markKey.current });
        }
        plyRef.current = idx + 1;
      }, 350 + step++ * 700);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle, status, report]);

  return {
    puzzle,
    fen,
    lastMove,
    orientation: solverColor === 'w' ? 'white' : 'black',
    solverColor,
    status,
    mark,
    pulse,
    shakeKey,
    hintsUsed,
    mistakes,
    retrying,
    progress: { done, total: puzzle ? playerMoveCount(puzzle) : 0 },
    playMove,
    hint,
    retry,
    showSolution,
  };
}
