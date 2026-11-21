import { Chess } from 'chess.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tablebase, TablebaseError, type TbMove, type TbPosition } from '../../shared/tablebase.ts';
import { goalReached, judgeUserMove, pickDefence } from './endgameLogic.ts';
import type { EndgamePosition } from './positions.ts';
import { saveSolve } from './progressStore.ts';

export type DrillStatus = 'loading' | 'offline' | 'playing' | 'thinking' | 'slip' | 'solved';

export interface Slip {
  message: string;
  /** The tablebase's favourite for the position before the slip. */
  best: TbMove | null;
  /** The opponent's move that led here, restored by Undo. */
  previousMove: [string, string] | null;
}

export interface DrillState {
  status: DrillStatus;
  fen: string;
  lastMove: [string, string] | null;
  /** Your moves so far. */
  moves: number;
  /** Tablebase answer for the position you are to move in (null while the opponent thinks). */
  tb: TbPosition | null;
  slip: Slip | null;
  /** Arrow shown by "Show best". */
  arrow: [string, string] | null;
  /** Bumps on every restart so the board deals the pieces fresh. */
  run: number;
}

const split = (uci: string) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });

const initial = (position: EndgamePosition, run: number): DrillState => ({
  status: 'loading',
  fen: position.fen,
  lastMove: null,
  moves: 0,
  tb: null,
  slip: null,
  arrow: null,
  run,
});

/** One drill: you move, the tablebase answers with perfect play, and every move of yours is judged against the tablebase. */
export function useEndgameDrill(position: EndgamePosition) {
  const [state, setState] = useState<DrillState>(() => initial(position, 0));
  const chess = useRef(new Chess(position.fen));
  /** Incremented to drop the answers of lookups that belong to an older run. */
  const token = useRef(0);

  /** Play the tablebase side until it is your move (or the drill is over), then fetch your options. */
  const settle = useCallback(
    async (mine: number, moves: number) => {
      const c = chess.current;
      try {
        for (;;) {
          if (goalReached(position.goal, c, moves, position.holdMoves)) {
            setState((s) => ({ ...s, status: 'solved', fen: c.fen(), moves, tb: null, arrow: null }));
            void saveSolve(position.id, moves);
            return;
          }
          const tb = await tablebase.lookup(c.fen());
          if (mine !== token.current) return;
          if (c.turn() === position.side) {
            setState((s) => ({ ...s, status: 'playing', fen: c.fen(), moves, tb, arrow: null }));
            return;
          }
          const reply = pickDefence(tb.moves);
          if (!reply) throw new TablebaseError('bad-response');
          const { from, to, promotion } = split(reply.uci);
          c.move({ from, to, promotion });
          setState((s) => ({ ...s, status: 'thinking', fen: c.fen(), lastMove: [from, to], moves, tb: null }));
        }
      } catch {
        if (mine === token.current) setState((s) => ({ ...s, status: 'offline', tb: null }));
      }
    },
    [position],
  );

  const restart = useCallback(() => {
    const mine = ++token.current;
    chess.current = new Chess(position.fen);
    setState((s) => initial(position, s.run + 1));
    void settle(mine, 0);
  }, [position, settle]);

  useEffect(() => {
    restart();
    return () => {
      token.current++;
    };
  }, [restart]);

  const play = useCallback(
    (uci: string) => {
      const { status, tb, moves } = state;
      const chosen = tb?.moves.find((m) => m.uci === uci);
      if (status !== 'playing' || !tb || !chosen) return;
      const { from, to, promotion } = split(uci);
      const previousMove = state.lastMove;
      chess.current.move({ from, to, promotion });
      const verdict = judgeUserMove(position.goal, chosen.category);
      if (!verdict.ok) {
        setState((s) => ({
          ...s,
          status: 'slip',
          fen: chess.current.fen(),
          lastMove: [from, to],
          moves: moves + 1,
          slip: { message: verdict.message, best: tb.moves[0] ?? null, previousMove },
          arrow: null,
        }));
        return;
      }
      setState((s) => ({ ...s, status: 'thinking', fen: chess.current.fen(), lastMove: [from, to], moves: moves + 1, tb: null, arrow: null }));
      void settle(token.current, moves + 1);
    },
    [state, position, settle],
  );

  /** Take back a move that threw the result away. With `showBest`, also draw the tablebase's choice. */
  const undo = useCallback(
    (showBest: boolean) => {
      const { slip, moves } = state;
      if (state.status !== 'slip' || !slip) return;
      chess.current.undo();
      const best = showBest && slip.best ? split(slip.best.uci) : null;
      setState((s) => ({
        ...s,
        status: 'playing',
        fen: chess.current.fen(),
        lastMove: slip.previousMove,
        moves: moves - 1,
        slip: null,
        arrow: best ? [best.from, best.to] : null,
      }));
    },
    [state],
  );

  /** After a failed lookup: carry on from the current position. */
  const retry = useCallback(() => {
    const mine = ++token.current;
    setState((s) => ({ ...s, status: 'loading' }));
    void settle(mine, state.moves);
  }, [settle, state.moves]);

  return { state, play, undo, restart, retry };
}
