import { Link } from 'react-router-dom';
import { Icons, PageHeader, Panel, Pill } from '../../../shared/ui.tsx';
import { OFFLINE_MESSAGE, solvedCount } from '../endgameLogic.ts';
import { ENDGAME_GROUPS, ENDGAMES, type EndgamePosition } from '../positions.ts';
import { useEndgameProgress } from '../progressStore.ts';
import { useOnline } from '../useOnline.ts';

const LEVELS = ['Easy', 'Medium', 'Hard'] as const;

/** /train/endgames: curated endgames grouped by type. */
export function EndgameList() {
  const progress = useEndgameProgress() ?? {};
  const online = useOnline();
  const total = ENDGAMES.length;
  const done = solvedCount(progress, ENDGAMES.map((p) => p.id));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Endgames"
        subtitle={`Play it out against perfect defence · ${done} of ${total} done`}
        icon={Icons.trophy('h-6 w-6')}
        right={
          <Link to="/train" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition hover:text-ink-100">
            ← Train
          </Link>
        }
      />

      {!online && (
        <Panel className="mb-4 border-bad-500/40 text-sm font-semibold text-bad-400">
          {OFFLINE_MESSAGE}
        </Panel>
      )}

      <div className="space-y-4">
        {ENDGAME_GROUPS.map((g) => {
          const items = ENDGAMES.filter((p) => p.group === g.id);
          return (
            <Panel key={g.id} className="animate-rise">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-extrabold">{g.title}</h2>
                  <p className="text-sm text-ink-400">{g.blurb}</p>
                </div>
                <span className="shrink-0 font-mono text-sm text-ink-400">
                  {solvedCount(progress, items.map((p) => p.id))}/{items.length}
                </span>
              </div>
              <ul className="divide-y divide-ink-700/60">
                {items.map((p) => (
                  <DrillRow key={p.id} position={p} best={progress[p.id]?.best} />
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function DrillRow({ position, best }: { position: EndgamePosition; best: number | undefined }) {
  return (
    <li>
      <Link
        to={`/train/endgames/${position.id}`}
        className="flex min-h-11 items-center gap-3 py-2 transition-colors hover:text-ember-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${best ? 'bg-good-500 text-ink-950' : 'border border-ink-600 text-transparent'}`}
          aria-label={best ? 'Done' : 'Not done yet'}
        >
          {Icons.check('h-4 w-4')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{position.title}</span>
          <span className="block text-xs text-ink-400">
            {LEVELS[position.difficulty - 1]}
            {best ? ` · best ${best} moves` : ''}
          </span>
        </span>
        <Pill className={position.goal === 'win' ? 'text-good-400' : 'text-ember-400'}>{position.goal === 'win' ? 'Win' : 'Hold'}</Pill>
        {Icons.chevRight('h-4 w-4 shrink-0 text-ink-500')}
      </Link>
    </li>
  );
}
