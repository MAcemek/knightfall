import { Link } from 'react-router-dom';
import { Button, Icons, Panel, Pill } from '../../shared/ui.tsx';
import { ProgressBar } from '../woodpecker/parts.tsx';
import { PHASES, weekInfo, type CoachPlan } from './planLogic.ts';
import { StopCards, SyncLine } from './StopCards.tsx';
import { useStopState } from './stopStore.ts';
import { startsLine, taskWhy, weekLine } from './todayText.ts';
import { toggleTick, type TodayData } from './todayStore.ts';
import { isTaskDone, type AutoState, type Task } from './todayLogic.ts';
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
    <Panel className="max-sm:p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-base font-extrabold sm:text-lg">Week {w.week} of 12</h2>
        <Pill>Phase {w.phase}</Pill>
        <span className="text-xs text-ink-400 sm:text-sm">Day {w.day} of 84</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-ink-300 sm:line-clamp-none sm:text-sm">{PHASES[w.phase]}</p>
    </Panel>
  );
}

function TaskRow({ task, auto, ticked, today }: { task: Task; auto: AutoState | undefined; ticked: boolean; today: string }) {
  const done = task.kind === 'auto' ? !!auto?.done : ticked;
  const linkClass = 'inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-ember-400 hover:text-ember-300';
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
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 break-words font-semibold leading-snug">
          <span className={done ? 'text-ink-300' : ''}>{task.title}</span>
          {task.optional && <Pill>Optional</Pill>}
        </div>
        <p className="text-sm text-ink-400">{task.detail}</p>
        <p className="mt-0.5 text-xs text-ink-400">
          About {task.minutes} min{auto ? `. ${auto.text}` : ''}
        </p>
      </div>
      <Link to={task.to} className={linkClass} aria-label={`Open ${task.title}`}>
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

function NextUp({ task, auto, today }: { task: Task | null; auto: TodayData['auto']; today: string }) {
  if (!task) {
    return (
      <Panel>
        <h2 className="text-lg font-extrabold">All done for today</h2>
        <p className="mt-1 text-sm text-ink-300">Every task on today's list is done. Rest, or take the optional one if you feel fresh.</p>
      </Panel>
    );
  }
  const state = task.kind === 'auto' ? auto[task.id as keyof typeof auto] : undefined;
  return (
    <Panel className="border-ember-500/40">
      <p className="text-xs font-bold uppercase tracking-wider text-ember-400">Next up</p>
      <h2 className="mt-1 break-words text-lg font-extrabold leading-snug">{task.title}</h2>
      <p className="mt-1 text-sm text-ink-300">{taskWhy(task)}</p>
      <p className="mt-1 text-xs text-ink-400">
        About {task.minutes} min{state ? `. ${state.text}` : ''}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={task.to}
          className="inline-flex h-12 min-w-0 flex-1 items-center justify-center rounded-xl bg-ember-500 px-6 text-lg font-bold text-ink-950 shadow-[0_4px_0_0_var(--color-ember-600)] transition hover:bg-ember-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 sm:flex-none"
        >
          Start
        </Link>
        {task.kind === 'manual' && (
          <Button variant="secondary" className="max-sm:flex-1" onClick={() => void toggleTick(today, task.id)}>
            Mark done
          </Button>
        )}
      </div>
    </Panel>
  );
}

function TodayBody({ plan, data, sync }: { plan: CoachPlan; data: TodayData; sync: CoachSync }) {
  const stop = useStopState(data.today, plan.startDate);
  const { today, tasks, auto, ticks, summary, next } = data;
  const w = weekInfo(plan.startDate, today);
  const open = tasks.filter((t) => !isTaskDone(t, auto, ticks));
  const done = tasks.filter((t) => isTaskDone(t, auto, ticks));
  const row = (t: Task) => <TaskRow key={t.id} task={t} auto={t.kind === 'auto' ? auto[t.id as keyof typeof auto] : undefined} ticked={ticks.includes(t.id)} today={today} />;
  return (
    <div className="space-y-4">
      <Banner plan={plan} today={today} />
      {w.state !== 'before' && (
        <>
          <NextUp task={next} auto={auto} today={today} />
          <Panel>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-extrabold">Today</h2>
              <span className="font-mono text-sm font-bold text-ink-300" aria-label={`${summary.done} of ${summary.total} done`}>
                {summary.done} of {summary.total}
              </span>
            </div>
            <ProgressBar done={summary.done} total={summary.total} label="Tasks done today" />
            {open.length > 0 && <ul className="mt-3 space-y-2">{open.map(row)}</ul>}
            {done.length > 0 && (
              <details className="mt-3">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400">
                  Done today ({done.length})
                </summary>
                <ul className="mt-1 space-y-2">{done.map(row)}</ul>
              </details>
            )}
            <p className="mt-3 text-xs text-ink-400">Tasks that show a count tick themselves when you do them in the app. The others you tick by hand.</p>
          </Panel>
          <Link
            to="/coach/week"
            className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-ink-700/60 bg-ink-850 p-4 shadow-xl shadow-black/20 transition hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
          >
            <span className="min-w-0">
              <span className="block text-lg font-extrabold">This week so far</span>
              <span className="block text-sm text-ink-300">{weekLine(data.weekDays)}</span>
            </span>
            {Icons.next('h-5 w-5 shrink-0')}
          </Link>
        </>
      )}
      <StopCards stop={stop} today={today} hasUser={!!plan.username} />
      <SyncLine lastSync={stop?.lastSync ?? null} sync={sync} hasUser={!!plan.username} />
    </div>
  );
}
