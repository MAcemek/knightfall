import { useEffect, useRef, useState } from 'react';
import { getEnginePool, isAbortError } from '../engine/index.ts';
import { Button } from '../ui.tsx';
import type { PuzzleRunner } from './usePuzzleRunner.ts';
import { explainWrong, fenAfterMove } from './whyLogic.ts';

type Phase = { kind: 'idle' } | { kind: 'thinking' } | { kind: 'done'; text: string } | { kind: 'error' };

/**
 * "Why was that wrong?" for the last wrong move (needs `explainMistakes` on the runner). Asks the engine
 * what happens after the move, says it in plain words and shows that position on the board until the
 * solver goes back to the puzzle.
 */
export function WhyWrong({ runner }: { runner: PuzzleRunner }) {
  const { wrongMove, peek, puzzle } = runner;
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  // A new wrong move or puzzle (and unmounting) drops any running check and starts over.
  useEffect(() => {
    setPhase({ kind: 'idle' });
    return () => abortRef.current?.abort();
  }, [wrongMove, puzzle]);

  // The solver moved on (a hint, a correct move, stepping, the solution) while the engine was thinking: drop the
  // check, or its answer would cover the live board.
  const movedOn = `${runner.hintsUsed}/${runner.progress.done}/${runner.review?.index ?? '-'}/${runner.status === 'solution'}`;
  useEffect(() => {
    abortRef.current?.abort();
    setPhase((p) => (p.kind === 'thinking' ? { kind: 'idle' } : p));
  }, [movedOn]);

  if (!wrongMove) return null;

  const check = () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setPhase({ kind: 'thinking' });
    const { fenBefore, uci } = wrongMove;
    let fenAfter: string;
    try {
      fenAfter = fenAfterMove(fenBefore, uci);
    } catch {
      setPhase({ kind: 'error' });
      return;
    }
    getEnginePool('lite')
      .evaluate({ fen: fenAfter, depth: 14, multiPv: 1, priority: 10, signal: ctl.signal })
      .then((ev) => {
        if (ctl.signal.aborted) return;
        const r = explainWrong(fenBefore, uci, ev);
        setPhase({ kind: 'done', text: r.text });
        runner.showPeek({
          fen: r.fenAfter,
          lastMove: [uci.slice(0, 2), uci.slice(2, 4)],
          arrow: r.reply ? { from: r.reply.uci.slice(0, 2), to: r.reply.uci.slice(2, 4), color: 'red' } : null,
        });
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted || isAbortError(e)) return;
        setPhase({ kind: 'error' });
      });
  };

  // The peek can end without this component (hint, retry, a new move): then offer the button again.
  const showing = phase.kind === 'done' && peek !== null;

  return (
    <div className="mt-2 space-y-2">
      {phase.kind === 'thinking' ? (
        <p className="flex min-h-11 items-center text-sm font-semibold text-ink-300" role="status">Thinking…</p>
      ) : showing ? (
        <div className="animate-feedback-in space-y-2 rounded-xl border border-ink-700/60 bg-ink-800/60 p-3">
          <p className="text-sm font-semibold text-ink-100">{phase.text}</p>
          <Button className="w-full" onClick={runner.closePeek}>Back to the puzzle</Button>
        </div>
      ) : (
        <>
          {phase.kind === 'error' && <p className="text-sm text-bad-400">Could not check that move right now.</p>}
          <Button className="w-full" onClick={check}>Why was that wrong?</Button>
        </>
      )}
    </div>
  );
}
