import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Icons, Panel, Segmented, Stat } from '../../shared/ui.tsx';
import type { CoachSpeed } from '../../shared/db.ts';
import { COACH_SPEEDS, SPEED_LABEL, type CoachPlan } from './planLogic.ts';
import { ratingDelta, targetLine } from './progressLogic.ts';
import { blunderTile, clockTile, ratingTile, secondsText } from './progressText.ts';
import { useProgress, type ProgressData } from './progressStore.ts';
import { RatingChart } from './RatingChart.tsx';

/** /coach/progress: the rating chart, three tiles and the Woodpecker cycles. */

const SPEED_OPTIONS = COACH_SPEEDS.map((s) => ({ id: s, label: SPEED_LABEL[s] }));

export function ProgressPage({ plan }: { plan: CoachPlan }) {
  const data = useProgress();
  const [speed, setSpeed] = useState<CoachSpeed>('rapid');
  if (!data) {
    return (
      <p className="text-sm text-ink-400" role="status">
        Loading your progress.
      </p>
    );
  }
  const series = data.ratings[speed];
  const line = targetLine(plan, speed);
  const rating = ratingTile(series, ratingDelta(series, line));
  const blunders = blunderTile(data.blunders);
  const clock = clockTile(data.clocks);
  return (
    <div className="space-y-4">
      <Panel>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold">Rating</h2>
          <Segmented options={SPEED_OPTIONS} value={speed} onChange={setSpeed} label="Speed" />
        </div>
        {series.length < 1 ? (
          <EmptyState icon={Icons.chart('h-6 w-6')} title={`No ${SPEED_LABEL[speed].toLowerCase()} rating yet`}>
            {plan.username ? 'Press Sync on the Today page. A rating is saved once a day while you use the Coach.' : 'Add your chess.com username in Plan settings, then press Sync on the Today page.'}
          </EmptyState>
        ) : (
          <RatingChart key={speed} ratings={series} line={line} label={SPEED_LABEL[speed]} />
        )}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={`${SPEED_LABEL[speed]} rating`} value={rating.value} sub={rating.sub} />
        <Stat label="Blunders per rapid game" value={blunders.value} sub={blunders.sub} />
        <Stat label="Clock used" value={clock.value} sub={clock.sub} />
      </div>

      <WoodCycles wood={data.wood} />
    </div>
  );
}

function WoodCycles({ wood }: { wood: ProgressData['wood'] }) {
  const { set, cycles } = wood;
  if (!set) {
    return (
      <Panel>
        <h2 className="text-lg font-extrabold">Woodpecker cycles</h2>
        <p className="mt-1 text-sm text-ink-400">
          No set yet. Make one in <Link to="/train/woodpecker" className="font-semibold text-ember-400 underline">Woodpecker</Link> and each cycle shows here.
        </p>
      </Panel>
    );
  }
  const worst = Math.max(1, ...cycles.map((c) => c.medianMs ?? 0));
  return (
    <Panel>
      <h2 className="text-lg font-extrabold">Woodpecker cycles</h2>
      <p className="mb-3 mt-1 break-words text-sm text-ink-400">{set.name}. Median time per puzzle should fall with every cycle.</p>
      <ul className="space-y-3">
        {cycles.map((c) => (
          <li key={c.n}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-bold">Cycle {c.n}{c.finished ? '' : ' (running)'}</span>
              <span className="text-ink-400">
                {c.done} of {c.total} done{c.days !== null ? `, ${c.days} ${c.days === 1 ? 'day' : 'days'}` : ''}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-800" aria-hidden>
              <div className="h-full rounded-full bg-ember-500" style={{ width: `${c.medianMs === null ? 0 : Math.max(4, (c.medianMs / worst) * 100)}%` }} />
            </div>
            <p className="mt-1 text-sm text-ink-300">
              Median {secondsText(c.medianMs)}, accuracy {c.accuracy === null ? 'none yet' : `${Math.round(c.accuracy * 100)}%`}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
