import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Attempt } from '../../../shared/db.ts';

const COUNT = 12;

/** Last attempts as green/red tiles with their deltas. Click one to replay it (unrated). */
export function HistoryStrip({ activeId, onReplay, locked = false }: {
  activeId: string | undefined;
  onReplay: (a: Attempt) => void;
  /** A rated puzzle is in progress: replays wait until it has an outcome (no free skips). */
  locked?: boolean;
}) {
  const rows = useLiveQuery(
    () =>
      db.attempts
        .orderBy('at')
        .reverse()
        .filter((a) => a.mode === 'rated')
        .limit(COUNT)
        .toArray(),
    [],
  );
  const list = rows ? [...rows].reverse() : [];
  const solved = list.filter((a) => a.solved).length;
  const newestId = rows?.[0]?.id;

  return (
    <div className="rounded-2xl border border-ink-700/60 bg-ink-850 p-4 shadow-xl shadow-black/20">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
          Recent{locked && list.length > 0 && <span className="ml-2 normal-case tracking-normal text-ink-500">· finish this puzzle to replay</span>}
        </span>
        {list.length > 0 && (
          <span className="font-mono text-xs text-ink-400">
            <span className="text-good-400">{solved}</span>/{list.length} solved
          </span>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-ink-500">Your last {COUNT} puzzles show up here. Tap one to replay it.</p>
      ) : (
        <div className="grid grid-cols-6 gap-1.5">
          {list.map((a) => {
            const d = a.delta ?? 0;
            const tone = a.solved
              ? d > 0
                ? 'bg-good-500/15 text-good-400 ring-good-500/40 hover:bg-good-500/25'
                : 'bg-sky-400/10 text-sky-400 ring-sky-400/30 hover:bg-sky-400/20'
              : 'bg-bad-500/15 text-bad-400 ring-bad-500/40 hover:bg-bad-500/25';
            const active = a.puzzleId === activeId;
            return (
              <button
                key={a.id}
                onClick={() => onReplay(a)}
                disabled={locked}
                title={`Puzzle ${a.puzzleRating} · ${a.solved ? (a.hintsUsed ? 'solved with hint' : 'solved') : 'missed'} · click to replay (unrated)`}
                className={`flex h-10 flex-col items-center justify-center rounded-lg font-mono text-xs font-bold ring-1 transition enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${active ? 'outline-2 outline-offset-2 outline-ember-400' : ''} ${a.id === newestId ? 'animate-pop' : ''}`}
              >
                <span className="text-[13px] leading-none">{a.solved ? '✓' : '✗'}</span>
                <span className="mt-0.5 leading-none">{d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '0'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
