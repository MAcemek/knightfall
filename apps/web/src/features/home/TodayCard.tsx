import { Link } from 'react-router-dom';
import { Icons, Panel } from '../../shared/ui.tsx';
import { goalProgress } from './homeLogic.ts';

const R = 30;
const CIRC = 2 * Math.PI * R;

/** Ring that fills as the goal is met. The transition is skipped under reduced motion by the global CSS rule. */
function GoalRing({ progress, label }: { progress: number; label: string }) {
  return (
    <svg viewBox="0 0 72 72" className="h-[72px] w-[72px] shrink-0 -rotate-90" role="img" aria-label={label}>
      <circle cx="36" cy="36" r={R} fill="none" strokeWidth="7" className="stroke-ink-700" />
      <circle
        cx="36"
        cy="36"
        r={R}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        className="stroke-ember-400 transition-[stroke-dashoffset] duration-700 ease-out"
        strokeDasharray={CIRC}
        strokeDashoffset={CIRC * (1 - progress)}
      />
    </svg>
  );
}

const BTN = 'flex min-h-12 flex-1 items-center justify-center whitespace-nowrap rounded-xl px-3 py-3 font-bold transition';

export function TodayCard({ solved, goal, dailySolved, dailyStreak }: { solved: number; goal: number; dailySolved: boolean; dailyStreak: number }) {
  const progress = goalProgress(solved, goal);
  const reached = progress !== null && progress >= 1;
  const text = reached ? 'Goal reached' : `${Math.min(solved, goal)} / ${goal} puzzles today`;
  return (
    <Panel className="animate-rise">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.15em] text-ember-400">Today</h2>
      {progress !== null && (
        <div className="mb-3 flex items-center gap-4">
          <GoalRing progress={progress} label={text} />
          <div>
            <div className="text-xl font-black leading-tight">{text}</div>
            {reached && <div className="text-sm text-ink-400">{solved} solved today</div>}
          </div>
        </div>
      )}
      {dailySolved ? (
        <div className="flex min-h-11 items-center gap-2 font-semibold text-good-400">
          {Icons.check('h-5 w-5')} Daily solved
        </div>
      ) : (
        <Link to="/daily" className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-ink-800/70 px-3 font-semibold transition hover:bg-ink-800">
          <span>Today&rsquo;s Daily: not solved yet</span>
          {Icons.next('h-4 w-4 shrink-0')}
        </Link>
      )}
      {!dailySolved && dailyStreak >= 1 && (
        <p className="mt-2 text-sm text-ink-300">Solve today&rsquo;s Daily to keep your {dailyStreak}-day streak</p>
      )}
      <div className="mt-4 flex gap-3">
        <Link to="/puzzles" className={`${BTN} bg-ember-500 text-ink-950 shadow-[0_4px_0_0_var(--color-ember-600)] hover:bg-ember-400`}>
          Keep solving
        </Link>
        <Link to="/rush" className={`${BTN} bg-ink-700 shadow-[0_4px_0_0_var(--color-ink-800)] hover:bg-ink-600`}>
          Play Rush
        </Link>
      </div>
    </Panel>
  );
}
