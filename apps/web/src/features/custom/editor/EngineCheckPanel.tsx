import { useCallback, useEffect, useRef, useState } from 'react';
import { getEnginePool, isAbortError } from '../../../shared/engine/index.ts';
import { Button } from '../../../shared/ui.tsx';
import { checkSolution, summarise, type MoveCheck } from '../engineCheck.ts';
import { Label } from './SetupStep.tsx';

type Phase = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

const TONE = {
  good: 'bg-good-500/10 text-good-400 ring-1 ring-good-500/30',
  warn: 'bg-ember-500/10 text-ember-300 ring-1 ring-ember-500/30',
  bad: 'bg-bad-500/10 text-bad-400 ring-1 ring-bad-500/30',
} as const;

function row(c: MoveCheck): { tone: keyof typeof TONE; icon: string; text: string } {
  const gap = c.gapCp === undefined ? '' : ` (+${(c.gapCp / 100).toFixed(1)} gap)`;
  switch (c.verdict) {
    case 'unique':
      return { tone: 'good', icon: '✓', text: 'Best move' };
    case 'trivial':
      return { tone: 'good', icon: '✓', text: 'Forced or mate' };
    case 'alternative':
      return { tone: 'warn', icon: '⚠', text: `Also wins: ${c.other ?? '?'}${gap}` };
    default:
      return { tone: 'bad', icon: '✗', text: `Engine prefers ${c.other ?? '?'}${gap}` };
  }
}

/** Optional engine check of the recorded solution. Never blocks saving. */
export function EngineCheckPanel({ fen, moves, opponentFirst }: { fen: string; moves: string[]; opponentFirst: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<MoveCheck[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const ctl = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
  }, []);

  const run = useCallback(() => {
    cancel();
    const ac = new AbortController();
    ctl.current = ac;
    setPhase('running');
    setResults([]);
    setTotal(0);
    setError('');
    checkSolution({
      fen,
      moves,
      opponentFirst,
      evaluate: (job) => getEnginePool('lite').evaluate(job),
      signal: ac.signal,
      onResult: (check, done, all) => {
        if (ac.signal.aborted) return;
        setResults((r) => [...r, check]);
        setTotal(all);
        if (done === all) setPhase('done');
      },
    })
      .then((all) => {
        if (ac.signal.aborted) return;
        setTotal(all.length);
        setPhase('done');
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || isAbortError(e)) return;
        setError(e instanceof Error ? e.message : 'The engine failed.');
        setPhase('error');
      });
  }, [cancel, fen, moves, opponentFirst]);

  // The solution changed under a running or finished check: drop it. Also abort on unmount.
  useEffect(() => {
    return () => {
      cancel();
      setPhase('idle');
      setResults([]);
    };
  }, [cancel, fen, moves, opponentFirst]);

  const running = phase === 'running';
  const summary = phase === 'done' ? summarise(results) : null;

  return (
    <div className="space-y-2.5 rounded-xl bg-ink-900 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Check with engine</Label>
        <span className="text-[11px] text-ink-500">Optional</span>
      </div>

      {results.length > 0 && (
        <ul className="space-y-1.5">
          {results.map((c) => {
            const r = row(c);
            return (
              <li key={c.ply} className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold ${TONE[r.tone]}`}>
                <span className="shrink-0" aria-hidden>
                  {r.icon}
                </span>
                <span className="min-w-0 break-words">
                  <span className="font-mono">{c.san}</span> · {r.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {running && (
        <p className="text-sm text-ink-300" role="status">
          Checking{total ? ` ${results.length}/${total}` : ''}…
        </p>
      )}
      {phase === 'cancelled' && <p className="text-sm text-ink-400">Check cancelled.</p>}
      {phase === 'error' && (
        <p className={`rounded-lg px-2.5 py-1.5 text-sm font-semibold ${TONE.bad}`} role="alert">
          Engine check failed: {error}
        </p>
      )}
      {summary && (
        <p className={`rounded-lg px-2.5 py-1.5 text-sm font-bold ${TONE[summary.tone === 'warn' ? 'warn' : summary.tone]}`} role="status">
          {summary.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button
            size="sm"
            onClick={() => {
              cancel();
              setPhase('cancelled');
            }}
          >
            Cancel
          </Button>
        ) : (
          <Button size="sm" onClick={run} disabled={moves.length === 0}>
            {phase === 'idle' ? 'Check with engine' : 'Re-check'}
          </Button>
        )}
        <span className="text-[11px] text-ink-500">Uses Stockfish in your browser.</span>
      </div>
    </div>
  );
}
