import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Icons, Panel, Stat } from '../../shared/ui.tsx';
import { SPEED_LABEL, type CoachPlan } from './planLogic.ts';
import { useLocalToday } from './todayStore.ts';
import { defaultWeek, planWeekRange, shiftWeek, summarizeWeek, weekLabel, weekNumber, type RatingWeek, type WeekSummary } from './weekLogic.ts';
import { useWeekData } from './weekStore.ts';

/** /coach/week: one Monday to Sunday of the plan, looked back on. */

const pct = (x: number | null) => (x === null ? 'None' : `${Math.round(x * 100)}%`);
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

const stepClass =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-ink-800 px-3 text-sm font-bold text-ink-100 transition-colors hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 disabled:opacity-40 disabled:hover:bg-ink-800';
const linkClass = 'inline-flex min-h-11 items-center font-semibold text-ember-400 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400';

export function WeekPage({ plan }: { plan: CoachPlan }) {
  const today = useLocalToday();
  const range = useMemo(() => planWeekRange(plan.startDate), [plan.startDate]);
  const [picked, setPicked] = useState<string | null>(null);
  const current = defaultWeek(range, today);
  const monday = picked ? shiftWeek(picked, 0, range) : current;
  const data = useWeekData(monday);
  const summary = useMemo(() => (data ? summarizeWeek({ ...data, monday, today, plan }) : null), [data, monday, today, plan]);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold">Week {weekNumber(monday, range)}</h2>
            <p className="text-sm text-ink-400">{weekLabel(monday)}</p>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Choose a week">
            <button type="button" className={stepClass} aria-label="Previous week" disabled={monday <= range.first} onClick={() => setPicked(shiftWeek(monday, -1, range))}>
              Back
            </button>
            <button type="button" className={stepClass} aria-label="Next week" disabled={monday >= range.last} onClick={() => setPicked(shiftWeek(monday, 1, range))}>
              Next
            </button>
            {monday !== current && (
              <button type="button" className={stepClass} onClick={() => setPicked(null)}>
                This week
              </button>
            )}
          </div>
        </div>
      </Panel>
      {!summary ? (
        <p className="text-sm text-ink-400" role="status">
          Loading the week.
        </p>
      ) : summary.future ? (
        <EmptyState icon={Icons.chart('h-6 w-6')} title="This week has not started">
          Come back after it, and the review shows here.
        </EmptyState>
      ) : summary.empty ? (
        <EmptyState icon={Icons.chart('h-6 w-6')} title="Nothing recorded this week">
          Tasks you finish, puzzles you solve and games you play show here. Start from the Today page.
        </EmptyState>
      ) : (
        <Review summary={summary} />
      )}
    </div>
  );
}

function Review({ summary }: { summary: WeekSummary }) {
  const { puzzles: p, games: g } = summary;
  return (
    <>
      <Panel>
        <h2 className="text-lg font-extrabold">Days active</h2>
        <Stat className="mt-3" label="Active days" value={`${summary.daysActive} of 7`} sub="A day with any task done" />
        <ul className="mt-3 space-y-2">
          {summary.kinds.map((k) => (
            <li key={k.id} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="min-w-0 font-bold">{k.label}</span>
                <span className="text-ink-400">{k.planned > 0 ? `${k.done} of ${days(k.planned)}` : k.done > 0 ? days(k.done) : 'Not planned'}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-800" aria-hidden>
                <div className="h-full rounded-full bg-ember-500" style={{ width: `${k.planned > 0 ? Math.min(100, (k.done / k.planned) * 100) : k.done > 0 ? 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <h2 className="text-lg font-extrabold">Puzzles</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Woodpecker" value={p.woodDone} sub={p.woodDone ? `${pct(p.woodAccuracy)} solved` : 'No puzzles'} />
          <Stat label="Rush runs" value={p.rushRuns} sub={p.rushBest === null ? 'No runs' : `Best score ${p.rushBest}`} />
          <Stat label="Blunder check" value={p.checkTotal} sub={p.checkTotal ? `${pct(p.checkRight)} right` : 'No positions'} className="col-span-2 sm:col-span-1" />
        </div>
      </Panel>

      <Panel>
        <h2 className="text-lg font-extrabold">Games</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Rapid games" value={g.rapid} sub={g.bot ? `${g.bot} more against the bot` : 'Not counting bot games'} />
          <Stat label="Self reviews" value={g.reviews} sub="Written before the engine" />
          <Stat label="Blunders per game" value={g.blundersPerGame === null ? 'None' : one(g.blundersPerGame)} sub={g.analysed ? `${g.analysed} analysed rapid ${g.analysed === 1 ? 'game' : 'games'}` : 'Analyse rapid games in Game Review'} />
          <Stat label="Clock used" value={pct(g.clock.share)} sub={g.clock.share === null ? 'Needs clock times' : g.clock.state === 'low' ? 'Low. Goal: 60 to 70%' : 'Goal: 60 to 70%'} />
          <Stat label="Bullet games" value={g.fastKnown ? `${g.bullet} of ${g.bulletLimit}` : 'None'} sub={g.fastKnown ? 'Weekly limit' : 'Synced fast games are kept for 35 days'} />
          <Stat label="Blitz stop rule" value={days(g.blitzStopDays)} sub="Two losses in a row" />
        </div>
      </Panel>

      <Panel>
        <h2 className="text-lg font-extrabold">Ratings</h2>
        {summary.ratings.length ? (
          <ul className="mt-2 divide-y divide-ink-700/60">
            {summary.ratings.map((r) => (
              <li key={r.speed} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className="font-bold">{SPEED_LABEL[r.speed]}</span>
                <span className="min-w-0 text-right text-ink-300">{ratingText(r)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-ink-400">No rating was saved this week. Press Sync on the Today page to save one.</p>
        )}
      </Panel>

      <Panel>
        <h2 className="text-lg font-extrabold">Next week</h2>
        <ul className="mt-2 space-y-2">
          {summary.focus.map((f) => (
            <li key={f.text} className="min-w-0 text-sm">
              <p className="break-words text-ink-100">{f.text}</p>
              <Link to={f.to} className={linkClass}>
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function ratingText(r: RatingWeek): string {
  const change = r.change === null ? 'one rating this week' : r.change === 0 ? 'no change' : `${r.change > 0 ? 'up' : 'down'} ${Math.abs(r.change)}`;
  const line = r.fromLine === null ? '' : r.fromLine === 0 ? ', on the target line' : `, ${Math.abs(r.fromLine)} ${r.fromLine > 0 ? 'above' : 'below'} the target line`;
  return `${r.last}, ${change}${line}`;
}
