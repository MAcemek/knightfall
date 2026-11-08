import { Icons } from '../../shared/ui.tsx';
import { formatSeconds, type RushAttempt } from './rushLogic.ts';

/** One attempted puzzle: rating + ✓/✗. Clickable when `onClick` is given (results screen). */
export function AttemptTile({ attempt, onClick, showTime = false }: { attempt: RushAttempt; onClick?: () => void; showTime?: boolean }) {
  const ok = attempt.solved;
  const cls = `group flex w-full animate-pop items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
    ok ? 'border-good-500/35 bg-good-500/10' : 'border-bad-500/35 bg-bad-500/10'
  } ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:border-ink-400/60 hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-ember-400' : ''}`;
  const body = (
    <>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${ok ? 'bg-good-500' : 'bg-bad-500'}`}>
        {ok ? Icons.check('h-3.5 w-3.5 stroke-[3.5]') : Icons.x('h-3.5 w-3.5 stroke-[3.5]')}
      </span>
      <span className="font-mono text-base font-bold text-ink-100 tabular">{attempt.puzzle.rating}</span>
      <span className="ml-auto font-mono text-xs text-ink-400 tabular">
        {showTime ? formatSeconds(attempt.timeMs) : `#${attempt.index + 1}`}
      </span>
      {onClick && <span className="text-ink-500 transition group-hover:text-ember-400">{Icons.eye('h-4 w-4')}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title="Review this puzzle">
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Live run log for the side column: newest on top, current puzzle pinned as a pending tile. */
export function RunTiles({ attempts, current }: { attempts: RushAttempt[]; current: { rating: number; index: number } | null }) {
  const solved = attempts.filter((a) => a.solved).length;
  const missed = attempts.length - solved;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-ink-400">
        <span>This run</span>
        <span className="flex gap-3 font-mono normal-case tracking-normal">
          <span className="text-good-400">✓ {solved}</span>
          <span className="text-bad-400">✗ {missed}</span>
        </span>
      </div>
      <div className="grid max-h-[46vh] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-3 lg:grid-cols-1 lg:max-h-[min(52vh,520px)]">
        {current && (
          <div key={`cur${current.index}`} className="flex animate-pop items-center gap-2.5 rounded-xl border border-ember-400/50 bg-ember-500/10 px-3 py-2">
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-ember-400/40" />
              <span className="h-2.5 w-2.5 rounded-full bg-ember-400" />
            </span>
            <span className="font-mono text-base font-bold text-ember-300 tabular">{current.rating}</span>
            <span className="ml-auto font-mono text-xs text-ink-400 tabular">#{current.index + 1}</span>
          </div>
        )}
        {[...attempts].reverse().map((a) => (
          <AttemptTile key={a.index} attempt={a} />
        ))}
        {!attempts.length && !current && <div className="col-span-full py-4 text-center text-sm text-ink-500">Solved puzzles stack up here.</div>}
      </div>
    </div>
  );
}
