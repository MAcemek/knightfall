import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Icons, PageHeader } from '../../shared/ui.tsx';
import { DailyPage } from './DailyPage.tsx';
import { LibraryPage } from './LibraryPage.tsx';
import { SettingsPage, SetupPage } from './PlanPages.tsx';
import type { CoachPlan } from './planLogic.ts';
import { usePlan } from './planStore.ts';
import { ProgressPage } from './ProgressPage.tsx';
import { TodayPage } from './TodayPage.tsx';
import { useToday } from './todayStore.ts';
import { useCoachSync } from './useCoachSync.ts';

/**
 * The 12-week Coach, mounted at /coach/*.
 *   /coach            setup without a plan, Today with one
 *   /coach/progress   rating chart and tiles
 *   /coach/daily      notes for Daily games (works without a plan)
 *   /coach/library    videos, books and tools (works without a plan)
 *   /coach/settings   change or remove the plan
 */

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${isActive ? 'bg-ink-700 text-ember-400' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'}`;

function SubNav({ hasPlan }: { hasPlan: boolean }) {
  const items = hasPlan
    ? [
        { to: '/coach', label: 'Today', end: true },
        { to: '/coach/progress', label: 'Progress' },
        { to: '/coach/daily', label: 'Daily helper' },
        { to: '/coach/library', label: 'Library' },
        { to: '/coach/settings', label: 'Plan settings' },
      ]
    : [
        { to: '/coach', label: 'Set up', end: true },
        { to: '/coach/daily', label: 'Daily helper' },
        { to: '/coach/library', label: 'Library' },
      ];
  return (
    <nav aria-label="Coach pages" className="mb-4 flex flex-wrap gap-1">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}

const Loading = () => (
  <p className="text-sm text-ink-400" role="status">
    Loading.
  </p>
);

export default function CoachPage() {
  const plan = usePlan();
  const today = useToday();
  const sync = useCoachSync(plan?.username ?? '');
  // Routes that need a plan wait for it to load, and go to the setup when there is none.
  const needPlan = (show: (p: CoachPlan) => React.ReactNode) => (plan === undefined ? <Loading /> : plan ? show(plan) : <Navigate to="/coach" replace />);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Coach" subtitle="A 12-week plan: a short daily list, a bullet limit and a blitz stop rule" icon={Icons.bulb('h-6 w-6')} />
      <SubNav hasPlan={!!plan} />
      <Routes>
        <Route index element={plan === undefined ? <Loading /> : plan ? <TodayPage plan={plan} data={today} sync={sync} /> : <SetupPage />} />
        <Route path="progress" element={needPlan((p) => <ProgressPage plan={p} />)} />
        <Route path="settings" element={needPlan((p) => <SettingsPage plan={p} />)} />
        <Route path="daily" element={<DailyPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="*" element={<Navigate to="/coach" replace />} />
      </Routes>
    </div>
  );
}
