import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { uciToMove, validateLine } from '@knightfall/core';
import { Board } from '../../../shared/Board/index.ts';
import { playMoveSound } from '../../../shared/PuzzlePlayer/index.ts';
import { burstAt, PALETTES, sfx } from '../../../shared/fx/index.ts';
import { Button, GameLayout, Icons, Panel } from '../../../shared/ui.tsx';
import { Kbd, StatusLine, useHotkeys } from '../bits.tsx';
import { isSolverPly, lineError, sideName, solverSide, type Side } from '../logic.ts';
import { Label } from './SetupStep.tsx';

export interface SolutionStepProps {
  startFen: string;
  moves: string[];
  setMoves: (m: string[]) => void;
  opponentFirst: boolean;
  setOpponentFirst: (v: boolean) => void;
  orientation: 'white' | 'black';
  setOrientation: (o: 'white' | 'black') => void;
  onBack: () => void;
  onContinue: () => void;
}

interface Replay {
  fen: string;
  san: string[];
  lastMove: [string, string] | null;
  mate: boolean;
  over: boolean;
}

function replay(startFen: string, moves: string[]): Replay {
  const c = new Chess(startFen);
  const san: string[] = [];
  let lastMove: [string, string] | null = null;
  for (const uci of moves) {
    try {
      const m = c.move(uciToMove(uci));
      san.push(m.san);
      lastMove = [m.from, m.to];
    } catch {
      break; // validateLine reports the illegal move
    }
  }
  return { fen: c.fen(), san, lastMove, mate: c.isCheckmate(), over: c.isGameOver() };
}

export function SolutionStep(props: SolutionStepProps) {
  const { startFen, moves, setMoves, opponentFirst, setOpponentFirst, orientation, setOrientation, onBack, onContinue } = props;
  const [shakeKey, setShakeKey] = useState(0);
  const boardWrap = useRef<HTMLDivElement>(null);
  const listEnd = useRef<HTMLDivElement>(null);

  const state = useMemo(() => replay(startFen, moves), [startFen, moves]);
  const solver: Side = solverSide(startFen, opponentFirst);
  const turn = state.fen.split(' ')[1] as Side;
  const startTurn = startFen.split(' ')[1] as Side;
  const startMoveNo = Number(startFen.split(' ')[5]) || 1;

  const error = useMemo(() => validateLine(startFen, moves) ?? lineError(moves, opponentFirst), [startFen, moves, opponentFirst]);
  const lastIsSolver = moves.length > 0 && isSolverPly(moves.length - 1, opponentFirst);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [moves.length]);

  const onMove = (uci: string) => {
    const c = new Chess(state.fen);
    let m;
    try {
      m = c.move(uciToMove(uci));
    } catch {
      return;
    }
    playMoveSound(m);
    const ply = moves.length;
    setMoves([...moves, uci]);
    if (isSolverPly(ply, opponentFirst)) {
      const el = boardWrap.current?.querySelector(`[data-square="${m.to}"]`);
      burstAt(el, { count: c.isCheckmate() ? 30 : 10, power: c.isCheckmate() ? 6 : 3.5, size: 4, colors: c.isCheckmate() ? PALETTES.ember : PALETTES.good, life: 40, gravity: 0.1 });
      if (c.isCheckmate()) setTimeout(() => sfx.sparkle(), 120);
    }
  };

  const undo = () => {
    if (!moves.length) return;
    setMoves(moves.slice(0, -1));
    sfx.click();
  };

  const clear = () => {
    if (!moves.length) return;
    setMoves([]);
    sfx.capture();
  };

  const toggleOpponentFirst = () => {
    const v = !opponentFirst;
    setOpponentFirst(v);
    setOrientation(solverSide(startFen, v) === 'w' ? 'white' : 'black');
    sfx.click();
  };

  const tryContinue = () => {
    if (error) {
      setShakeKey((k) => k + 1);
      sfx.wrong();
      return;
    }
    sfx.correct();
    onContinue();
  };

  useHotkeys({
    Backspace: undo,
    ArrowLeft: undo,
    'ctrl+z': undo,
    f: () => setOrientation(orientation === 'white' ? 'black' : 'white'),
  });

  const mark = lastIsSolver && state.lastMove ? { square: state.lastMove[1], kind: state.mate ? ('mate' as const) : ('best' as const), key: moves.length } : null;

  // Who plays next, in puzzle terms
  const nextRole = isSolverPly(moves.length, opponentFirst) ? 'solver' : 'opponent';
  const prompt = state.over
    ? state.mate
      ? 'Checkmate — the line is complete.'
      : 'Game over (draw) — no more moves.'
    : moves.length === 0 && opponentFirst
      ? `Play ${sideName(turn)}'s setup move (the move the solver must answer).`
      : nextRole === 'solver'
        ? `Play the solution move for ${sideName(turn)}.`
        : `Play ${sideName(turn)}'s best defence, or finish here.`;

  return (
    <GameLayout
      board={
        <div ref={boardWrap}>
          <Board
            fen={state.fen}
            orientation={orientation}
            interactive={!state.over}
            movableColor={turn}
            lastMove={state.lastMove}
            mark={mark}
            onMove={onMove}
            shakeKey={shakeKey}
          />
        </div>
      }
      side={
        <Panel className="space-y-4">
          <div className="flex items-start gap-2.5">
            <span className={`mt-1 inline-block h-4 w-4 shrink-0 rounded-sm ${turn === 'w' ? 'bg-ink-100' : 'bg-ink-950 ring-1 ring-ink-400'}`} />
            <p className={`font-bold ${state.mate ? 'text-ember-400' : nextRole === 'solver' ? 'text-ink-100' : 'text-ink-300'}`}>{prompt}</p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-ink-900 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-ember-500)]" checked={opponentFirst} onChange={toggleOpponentFirst} />
            <span>
              <span className="font-semibold text-ink-100">First move is the opponent's setup move</span>
              <span className="mt-0.5 block text-xs text-ink-400">
                It's played automatically, then {sideName(solver)} solves.
              </span>
            </span>
          </label>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>Solution line</Label>
              <div className="flex gap-3 text-[11px] font-semibold text-ink-400">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-ember-400" /> Solver
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-ink-500" /> Opponent
                </span>
              </div>
            </div>
            <div className="max-h-48 min-h-[3.25rem] overflow-y-auto rounded-xl bg-ink-900 p-2.5">
              {moves.length === 0 ? (
                <p className="py-1.5 text-center text-sm text-ink-500">Make moves on the board to record the line.</p>
              ) : (
                <ol className="flex flex-wrap gap-1.5">
                  {state.san.map((san, i) => {
                    const white = (startTurn === 'w') === (i % 2 === 0);
                    const moveNo = startMoveNo + Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2);
                    const solverMove = isSolverPly(i, opponentFirst);
                    const last = i === moves.length - 1;
                    return (
                      <li
                        key={i}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-sm font-semibold ${last ? 'animate-pop' : ''} ${
                          solverMove ? 'bg-ember-500/15 text-ember-300 ring-1 ring-ember-500/40' : 'bg-ink-800 text-ink-300'
                        }`}
                      >
                        {(white || i === 0) && <span className="text-ink-500">{white ? `${moveNo}.` : `${moveNo}…`}</span>}
                        {san}
                      </li>
                    );
                  })}
                </ol>
              )}
              <div ref={listEnd} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button size="sm" onClick={undo} disabled={!moves.length} title="Undo (Backspace)">
                {Icons.retry('h-4 w-4')} Undo
              </Button>
              <Button size="sm" variant="ghost" onClick={clear} disabled={!moves.length}>
                Clear line
              </Button>
            </div>
          </div>

          <StatusLine
            error={error}
            okText={`${moves.filter((_, i) => isSolverPly(i, opponentFirst)).length} solver move${
              moves.filter((_, i) => isSolverPly(i, opponentFirst)).length === 1 ? '' : 's'
            } recorded${state.mate ? ', ending in mate' : ''}.`}
          />

          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button size="lg" onClick={onBack} aria-label="Back to position">
              {Icons.next('h-5 w-5 rotate-180')}
            </Button>
            <Button variant="primary" size="lg" onClick={tryContinue}>
              Details {Icons.next('h-5 w-5')}
            </Button>
          </div>

          <div className="hidden flex-wrap gap-x-3 gap-y-1.5 text-xs text-ink-400 sm:flex">
            <span>
              <Kbd>⌫</Kbd> undo
            </span>
            <span>
              <Kbd>F</Kbd> flip
            </span>
            <span>Both sides are playable — you play the whole line.</span>
          </div>
        </Panel>
      }
    />
  );
}
