import { lazy, Suspense, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { FxLayer, isMuted, setMuted } from './shared/fx/index.ts';
import { Icons } from './shared/ui.tsx';
import { useProfile } from './shared/profile.ts';

/**
 * Each mode lives in src/features/<mode>/ and default-exports its page from Page.tsx.
 * Routes below are the only place features are wired in.
 */
const Home = lazy(() => import('./features/home/Page.tsx'));
const Puzzles = lazy(() => import('./features/puzzles/Page.tsx'));
const Daily = lazy(() => import('./features/daily/Page.tsx'));
const Rush = lazy(() => import('./features/rush/Page.tsx'));
const Battle = lazy(() => import('./features/battle/Page.tsx'));
const Custom = lazy(() => import('./features/custom/Page.tsx'));

const NAV = [
  { to: '/', label: 'Home', icon: Icons.home, end: true },
  { to: '/puzzles', label: 'Puzzles', icon: Icons.puzzle },
  { to: '/daily', label: 'Daily', icon: Icons.calendar },
  { to: '/rush', label: 'Rush', icon: Icons.bolt },
  { to: '/battle', label: 'Battle', icon: Icons.swords },
  { to: '/custom', label: 'Custom', icon: Icons.pencil },
];

export function App() {
  const [muted, setM] = useState(isMuted());
  const profile = useProfile();
  return (
    <div className="flex min-h-full flex-col bg-ink-950 lg:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-ink-800 bg-ink-900 px-3 py-5 lg:flex">
        <NavLink to="/" className="mb-7 flex items-center gap-2.5 px-2">
          <img src="/pieces/wN.svg" alt="" className="h-9 w-9 -scale-x-100 drop-shadow-[0_0_10px_rgb(255_154_31/0.45)]" />
          <span className="text-xl font-black tracking-tight">
            Knight<span className="text-ember-400">fall</span>
          </span>
        </NavLink>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold transition ${isActive ? 'bg-ink-800 text-ember-400' : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100'}`
              }
            >
              {n.icon('h-5 w-5')}
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-2">
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
          <button
            className="flex items-center gap-2 text-sm text-ink-400 hover:text-ink-100"
            onClick={() => {
              setMuted(!muted);
              setM(!muted);
            }}
          >
            {muted ? Icons.mute('h-4 w-4') : Icons.volume('h-4 w-4')} Sound {muted ? 'off' : 'on'}
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
        <button
          className="text-ink-300"
          aria-label="Toggle sound"
          onClick={() => {
            setMuted(!muted);
            setM(!muted);
          }}
        >
          {muted ? Icons.mute() : Icons.volume()}
        </button>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 lg:px-8 lg:pb-8 lg:pt-8">
        <Suspense fallback={<div className="p-10 text-center text-ink-400">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/puzzles/*" element={<Puzzles />} />
            <Route path="/daily/*" element={<Daily />} />
            <Route path="/rush/*" element={<Rush />} />
            <Route path="/battle/*" element={<Battle />} />
            <Route path="/custom/*" element={<Custom />} />
            <Route path="*" element={<div className="p-10 text-center text-ink-400">Page not found.</div>} />
          </Routes>
        </Suspense>
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-ink-800 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? 'text-ember-400' : 'text-ink-400'}`}
          >
            {n.icon('h-5 w-5')}
            {n.label}
          </NavLink>
        ))}
      </nav>
      <FxLayer />
    </div>
  );
}
