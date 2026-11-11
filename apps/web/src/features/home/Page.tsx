import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { dailyStreak, utcDateKey } from '@knightfall/core';
import { db } from '../../shared/db.ts';
import { useProfile } from '../../shared/profile.ts';
import { useReviewSummary } from '../../shared/progress/index.ts';
import { prefetchAround } from '../../shared/puzzleSource.ts';
import { Icons, Panel } from '../../shared/ui.tsx';

const MODES = [
  { to: '/puzzles', title: 'Puzzles', blurb: 'Rated tactics matched to your level. Build a streak.', icon: Icons.puzzle, tint: 'from-ember-500/25' },
  { to: '/train', title: 'Train', blurb: 'Drill a theme or review the puzzles you missed. Unrated.', icon: Icons.target, tint: 'from-ember-300/20' },
  { to: '/daily', title: 'Daily Puzzle', blurb: 'One hand-picked puzzle a day, same for everyone.', icon: Icons.calendar, tint: 'from-sky-400/25' },
  { to: '/rush', title: 'Puzzle Rush', blurb: 'Solve as many as you can. Three strikes and you are out.', icon: Icons.bolt, tint: 'from-good-500/25' },
  { to: '/battle', title: 'Puzzle Battle', blurb: 'Race a live opponent through the same puzzles.', icon: Icons.swords, tint: 'from-bad-500/25' },
  { to: '/custom', title: 'Custom Puzzles', blurb: 'Set up a position, record the solution, share a link.', icon: Icons.pencil, tint: 'from-violet-400/25' },
  { to: '/stats', title: 'Stats & Achievements', blurb: 'Rating curve, strengths, weaknesses and unlocks.', icon: Icons.chart, tint: 'from-sky-400/15' },
];

export default function HomePage() {
  const profile = useProfile();
  const stats = useLiveQuery(async () => {
    const [bestRush, daily, solved, attempts] = await Promise.all([
      db.rushRuns.orderBy('score').last(),
      db.daily.toArray(),
      db.attempts.filter((a) => a.solved).count(),
      db.attempts.count(),
    ]);
    return {
      attempts,
      bestRush: bestRush?.score ?? 0,
      dailyStreak: dailyStreak(daily.filter((d) => d.solved).map((d) => d.date), utcDateKey(new Date())),
      solved,
    };
  }, []);
  const reviews = useReviewSummary();
  const rating = profile?.puzzleRating.rating;
  useEffect(() => {
    if (rating !== undefined) prefetchAround(rating);
  }, [rating]);

  return (
    <div className="mx-auto max-w-5xl">
      <section className="relative mb-8 overflow-hidden rounded-3xl border border-ink-800 bg-gradient-to-br from-ink-850 via-ink-900 to-ink-950 p-7 sm:p-10">
        <img src="/pieces/bN.svg" alt="" className="pointer-events-none absolute -right-8 -top-6 h-64 w-64 rotate-12 opacity-[0.07]" />
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-ember-400">Train your tactics</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">
          Find the move.
          <br />
          <span className="text-ink-400">Feel the click.</span>
        </h1>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/puzzles" className="rounded-xl bg-ember-500 px-6 py-3 font-bold text-ink-950 shadow-[0_4px_0_0_var(--color-ember-600)] transition hover:bg-ember-400">
            Start solving
          </Link>
          <Link to="/rush" className="rounded-xl bg-ink-700 px-6 py-3 font-bold shadow-[0_4px_0_0_var(--color-ink-800)] transition hover:bg-ink-600">
            Play Rush
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <HeroStat label="Puzzle rating" value={profile ? Math.round(profile.puzzleRating.rating) : '—'} />
          <HeroStat label="Streak" value={profile ? `${profile.puzzleStreak.current} 🔥` : '—'} />
          <HeroStat label="Daily streak" value={stats ? `${stats.dailyStreak} days` : '—'} />
          <HeroStat label="Best rush" value={stats?.bestRush ?? '—'} />
        </div>
      </section>

      {stats && stats.attempts === 0 && (
        <Panel className="mb-6 animate-rise">
          <h2 className="mb-3 text-lg font-extrabold">New here? Three quick steps</h2>
          <ol className="space-y-2">
            {[
              ['/puzzles', 'Solve your first rated puzzle'],
              ['/daily', "Try today's Daily"],
              ['/train', 'Missed one? It shows up in Train for review'],
            ].map(([to, text], i) => (
              <li key={to}>
                <Link to={to} className="flex items-center gap-3 rounded-xl bg-ink-800/70 px-3 py-2.5 font-semibold transition hover:bg-ink-800">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ember-500/15 font-mono font-bold text-ember-400">{i + 1}</span>
                  <span className="flex-1">{text}</span>
                  {Icons.next('h-4 w-4')}
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {(reviews?.due ?? 0) > 0 && (
        <Link
          to="/train/review"
          className="mb-6 flex animate-rise items-center justify-between rounded-2xl border border-ember-500/30 bg-ember-500/10 px-5 py-3 font-semibold text-ember-300 transition hover:bg-ember-500/15"
        >
          {Icons.layers('h-5 w-5')}
          <span className="flex-1 px-3">
            {reviews!.due} puzzle{reviews!.due === 1 ? '' : 's'} ready for review
          </span>
          {Icons.next('h-5 w-5')}
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODES.map((m, i) => (
          <Link
            key={m.to}
            to={m.to}
            style={{ animationDelay: `${i * 45}ms` }}
            className={`group relative animate-rise overflow-hidden rounded-2xl border border-ink-800 bg-gradient-to-br ${m.tint} to-ink-900 to-60% p-5 transition hover:-translate-y-0.5 hover:border-ink-600`}
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-ink-950/60 text-ember-400 transition group-hover:scale-110">{m.icon('h-6 w-6')}</div>
            <h2 className="text-lg font-extrabold">{m.title}</h2>
            <p className="mt-1 text-sm text-ink-400">{m.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-ink-950/50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-bold">{value}</div>
    </div>
  );
}
