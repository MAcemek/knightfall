import { Link } from 'react-router-dom';
import { Icons, Panel, Pill } from '../../shared/ui.tsx';
import { ProgressBar } from '../woodpecker/parts.tsx';
import { PHASES, weekInfo, type CoachPlan } from './planLogic.ts';
import { StopCards, SyncLine } from './StopCards.tsx';
import { useStopState } from './stopStore.ts';
import { startsLine } from './todayText.ts';
import { toggleTick, type TodayData } from './todayStore.ts';
import type { AutoState, Task } from './todayLogic.ts';
import type { CoachSync } from './useCoachSync.ts';

/** /coach with a plan: the week, today's tasks, the stop rules and the sync line. */

function Banner({ plan, today }: { plan: CoachPlan; today: string }) {
  const w = weekInfo(plan.startDate, today);
  if (w.state === 'before') {
    return (
      <Panel>
        <h2 className="text-lg font-extrabold">Not started yet</h2>
        <p className="mt-1 text-sm text-ink-300">{startsLine(-w.offset, plan.startDate)}</p>
      </Panel>
    );
  }
  if (w.state === 'after') {
    return (
      <Panel>
        <h2 className="text-lg font-extrabold">The 12 weeks are done</h2>
        <p className="mt-1 text-sm text-ink-300">Look at your progress, then decide what comes next. You can keep the daily list as it is, or begin a new plan.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/coach/progress" className="inline-flex min-h-11 items-center rounded-xl bg-ink-700 px-4 font-bold shadow-[0_4px_0_0_var(--color-ink-800)] transition hover:bg-ink-600">
            See your progress
          </Link>
          <Link to="/coach/settings" state={{ fresh: true }} className="inline-flex min-h-11 items-center rounded-xl bg-ember-500 px-4 font-bold text-ink-950 shadow-[0_4px_0_0_var(--color-ember-600)] transition hover:bg-ember-400">
            Start a new plan
          </Link>
        </div>
      </Panel>
    );
  }
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-extrabold">Week {w.week} of 12</h2>
        <Pill>Phase {w.phase}</Pill>
        <span className="text-sm text-ink-400">Day {w.day} of 84</span>
      </div>
      <p className="mt-1 text-sm text-ink-300">{PHASES[w.phase]}</p>
    </Panel>
  );
}

function TaskRow({ task, auto, ticked, today }: { task: Task; auto: AutoState | undefined; ticked: boolean; today: string }) {
  const done = task.kind === 'auto' ? !!auto?.done : ticked;
  const box = `flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 ${done ? 'border-good-500 bg-good-500 text-ink-950' : 'border-ink-600 text-transparent'}`;
  return (
    <li className="flex items-start gap-2 rounded-xl bg-ink-800/70 py-1 pl-1 pr-1">
      {task.kind === 'auto' ? (
        <span role="img" aria-label={done ? 'Done' : 'Not done yet'} className={box}>
          {Icons.check('h-5 w-5')}
        </span>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={ticked}
          aria-label={`${task.title}, done`}
          onClick={() => void toggleTick(today, task.id)}
          className={`${box} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400`}
        >
          {Icons.check('h-5 w-5')}
        </button>
      )}
      <div className="min-w-0 flex-1 py-2">
        <div className="flex flex-wrap items-center gap-x-2 font-semibold leading-snug">
          <span className={done ? 'text-ink-300' : ''}>{task.title}</span>
          {task.optional && <Pill>Optional</Pill>}
        </div>
        <p className="text-sm text-ink-400">{task.detail}</p>
        <p className="mt-0.5 text-xs text-ink-400">
          About {task.minutes} min{auto ? `. ${auto.text}` : ''}
        </p>
      </div>
      <Link to={task.to} className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-ember-400 hover:text-ember-300" aria-label={`Open ${task.title}`}>
        Open
      </Link>
    </li>
  );
}

export function TodayPage({ plan, data, sync }: { plan: CoachPlan; data: TodayData | undefined; sync: CoachSync }) {
  if (!data) {
    return (
      <p className="text-sm text-ink-400" role="status">
        Loading your day.
      </p>
    );
  }
  return <TodayBody plan={plan} data={data} sync={sync} />;
}

function TodayBody({ plan, data, sync }: { plan: CoachPlan; data: TodayData; sync: CoachSync }) {
  const stop = useStopState(data.today);
  const { today, tasks, auto, ticks, summary } = data;
  const w = weekInfo(plan.startDate, today);
  return (
    <div className="space-y-4">
      <Banner plan={plan} today={today} />
      {w.state !== 'before' && (
        <Panel>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-extrabold">Today</h2>
            <span className="font-mono text-sm font-bold text-ink-300" aria-label={`${summary.done} of ${summary.total} done`}>
              {summary.done} of {summary.total}
            </span>
          </div>
          <ProgressBar done={summary.done} total={summary.total} label="Tasks done today" />
          <ul className="mt-3 space-y-2">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} auto={t.kind === 'auto' ? auto[t.id as keyof typeof auto] : undefined} ticked={ticks.includes(t.id)} today={today} />
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-400">Tasks that show a count tick themselves when you do them in the app. The others you tick by hand.</p>
        </Panel>
      )}
      <StopCards stop={stop} today={today} hasUser={!!plan.username} />
      <SyncLine lastSync={stop?.lastSync ?? null} sync={sync} hasUser={!!plan.username} />
    </div>
  );
}
