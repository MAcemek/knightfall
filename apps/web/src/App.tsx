import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { FxLayer } from './shared/fx/index.ts';
import { Icons } from './shared/ui.tsx';
import { useProfile } from './shared/profile.ts';
import { ProgressWatcher, useReviewSummary } from './shared/progress/index.ts';
import { setSetting, useSettings } from './shared/settings.ts';
import { ToastHost } from './shared/toast.tsx';

/**
 * Each mode lives in src/features/<mode>/ and default-exports its page from Page.tsx.
 * Routes below are the only place features are wired in.
 */
const Home = lazy(() => import('./features/home/Page.tsx'));
const Puzzles = lazy(() => import('./features/puzzles/Page.tsx'));
const Train = lazy(() => import('./features/train/Page.tsx'));
const Daily = lazy(() => import('./features/daily/Page.tsx'));
const Rush = lazy(() => import('./features/rush/Page.tsx'));
const Battle = lazy(() => import('./features/battle/Page.tsx'));
const Custom = lazy(() => import('./features/custom/Page.tsx'));
const Stats = lazy(() => import('./features/stats/Page.tsx'));
const Settings = lazy(() => import('./features/settings/Page.tsx'));

/** Main modes: desktop sidebar + mobile bottom bar (7 columns). */
const NAV = [
  { to: '/', label: 'Home', icon: Icons.home, end: true },
  { to: '/puzzles', label: 'Puzzles', icon: Icons.puzzle },
  { to: '/train', label: 'Train', icon: Icons.target },
  { to: '/daily', label: 'Daily', icon: Icons.calendar },
  { to: '/rush', label: 'Rush', icon: Icons.bolt },
  { to: '/battle', label: 'Battle', icon: Icons.swords },
  { to: '/custom', label: 'Custom', icon: Icons.pencil },
];

/** Secondary pages: below the modes in the sidebar, icons in the mobile top bar. */
const MORE = [
  { to: '/stats', label: 'Stats', icon: Icons.chart },
  { to: '/settings', label: 'Settings', icon: Icons.sliders },
];

const sideLink = ({ isActive }: { isActive: boolean }) =>
  `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold transition-colors ${isActive ? 'bg-ink-800 text-ember-400' : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100'}`;

export function App() {
  const settings = useSettings();
  const profile = useProfile();
  const reviews = useReviewSummary();
  const due = reviews?.due ?? 0;
  // Page transition is keyed on the first path segment only, so /rush → /rush/play/3min (and the other
  // in-feature navigations) never remounts a page.
  const section = useLocation().pathname.split('/')[1] ?? '';
  const toggleSound = () => setSetting('sound', !settings.sound);

  return (
    <div className="flex min-h-full flex-col bg-ink-950 lg:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-ink-800 bg-ink-900 px-3 py-5 lg:flex">
        <NavLink to="/" className="group mb-7 flex items-center gap-2.5 px-2">
          <img src="/pieces/wN.svg" alt="" className="h-9 w-9 -scale-x-100 drop-shadow-[0_0_10px_rgb(255_154_31/0.45)] transition-transform duration-300 group-hover:-rotate-12" />
          <span className="text-xl font-black tracking-tight">
            Knight<span className="text-ember-400">fall</span>
          </span>
        </NavLink>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={sideLink}>
              <span className="transition-transform duration-150 group-hover:scale-110">{n.icon('h-5 w-5')}</span>
              {n.label}
              {n.to === '/train' && due > 0 && (
                <span className="ml-auto rounded-full bg-ember-500 px-1.5 font-mono text-[11px] font-black leading-5 text-ink-950" title={`${due} review${due === 1 ? '' : 's'} due`}>
                  {due > 99 ? '99+' : due}
                </span>
              )}
            </NavLink>
          ))}
          <div className="my-2 border-t border-ink-800" />
          {MORE.map((n) => (
            <NavLink key={n.to} to={n.to} className={sideLink}>
              <span className="transition-transform duration-150 group-hover:scale-110">{n.icon('h-5 w-5')}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-2 pt-4">
          {profile && (
            <div className="rounded-xl bg-ink-850 p-3 text-sm">
              <div className="truncate font-semibold">{profile.name}</div>
              <div className="mt-1 flex justify-between text-ink-400">
                <span>Puzzles</span>
                <span className="font-mono font-bold text-ink-100">{Math.round(profile.puzzleRating.rating)}</span>
              </div>
              <div className="flex justify-between text-ink-400">
                <span>Battle</span>
                <span className="font-mono font-bold text-ink-100">{profile.battleRating}</span>
              </div>
            </div>
          )}
          <button className="flex items-center gap-2 text-sm text-ink-400 transition-colors hover:text-ink-100" onClick={toggleSound}>
            {settings.sound ? Icons.volume('h-4 w-4') : Icons.mute('h-4 w-4')} Sound {settings.sound ? 'on' : 'off'}
          </button>
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-800 bg-ink-900/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <NavLink to="/" className="flex items-center gap-2">
          <img src="/pieces/wN.svg" alt="" className="h-7 w-7 -scale-x-100" />
          <span className="text-lg font-black">
            Knight<span className="text-ember-400">fall</span>
          </span>
        </NavLink>
        <div className="flex items-center gap-4">
          {MORE.map((n) => (
            <NavLink key={n.to} to={n.to} aria-label={n.label} className={({ isActive }) => (isActive ? 'text-ember-400' : 'text-ink-300')}>
              {n.icon()}
            </NavLink>
          ))}
          <button className="text-ink-300" aria-label="Toggle sound" onClick={toggleSound}>
            {settings.sound ? Icons.volume() : Icons.mute()}
          </button>
        </div>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 lg:px-8 lg:pb-8 lg:pt-8">
        <div key={section} className="animate-page-in">
          <Suspense fallback={<div className="p-10 text-center text-ink-400">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/puzzles/*" element={<Puzzles />} />
              <Route path="/train/*" element={<Train />} />
              <Route path="/daily/*" element={<Daily />} />
              <Route path="/rush/*" element={<Rush />} />
              <Route path="/battle/*" element={<Battle />} />
              <Route path="/custom/*" element={<Custom />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<div className="p-10 text-center text-ink-400">Page not found.</div>} />
            </Routes>
          </Suspense>
        </div>
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-ink-800 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors ${isActive ? 'text-ember-400' : 'text-ink-400'}`}
          >
            {n.icon('h-5 w-5')}
            {n.label}
            {n.to === '/train' && due > 0 && <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-ember-500" />}
          </NavLink>
        ))}
      </nav>
      <ProgressWatcher />
      <ToastHost />
      <FxLayer />
    </div>
  );
}
