import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProfile } from '../../shared/profile.ts';
import { EmptyState, Icons, PageHeader, Panel, Stat } from '../../shared/ui.tsx';
import { ActivityHeatmap } from './ActivityHeatmap.tsx';
import { AchievementGrid } from './AchievementGrid.tsx';
import { RatingChart } from './RatingChart.tsx';
import { ThemeBreakdown } from './ThemeBreakdown.tsx';
import { battleSummary, formatDuration, ratingSeries, rushBests, totals } from './statsLogic.ts';
import { useStatsData, useThemeRows } from './useStatsData.ts';

const RUSH_LABELS = [
  ['3min', '3 Minutes'],
  ['5min', '5 Minutes'],
  ['survival', 'Survival'],
] as const;

export default function StatsPage() {
  const data = useStatsData();
  const profile = useProfile();
  const rows = useThemeRows(data?.attempts);

  const series = useMemo(() => (data ? ratingSeries(data.attempts) : []), [data]);
  const t = useMemo(() => totals(data?.attempts ?? []), [data]);
  const rush = useMemo(() => rushBests(data?.rushRuns ?? []), [data]);
  const battle = useMemo(() => battleSummary(data?.battles ?? []), [data]);
  const timestamps = useMemo(() => (data ? [...data.attempts.map((a) => a.at), ...data.daily.map((d) => d.at)] : []), [data]);

  if (!data || !profile) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Stats" subtitle="Your progress at a glance" icon={Icons.chart('h-6 w-6')} />
        <p className="p-10 text-center text-ink-400">Loading…</p>
      </div>
    );
  }

  const tiles = [
    <Stat key="r" label="Puzzle rating" value={Math.round(profile.puzzleRating.rating)} sub={`best streak ${profile.puzzleStreak.best}`} />,
    <Stat key="s" label="Solved" value={t.solved} sub={`of ${t.attempted} attempts`} />,
    <Stat key="a" label="Accuracy" value={t.accuracy === null ? '–' : `${Math.round(t.accuracy * 100)}%`} accent="text-good-400" />,
    <Stat key="t" label="Time solving" value={formatDuration(t.timeMs)} />,
  ];
  const noRush = RUSH_LABELS.every(([k]) => rush[k].runs === 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Stats" subtitle="Your progress at a glance" icon={Icons.chart('h-6 w-6')} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile, i) => (
          <div key={i} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>{tile}</div>
        ))}
      </div>
      <Panel>
        <h2 className="mb-3 text-lg font-extrabold">Rating over time</h2>
        <RatingChart points={series} />
      </Panel>
      <Panel>
        <h2 className="mb-3 text-lg font-extrabold">Strengths and weaknesses</h2>
        <ThemeBreakdown rows={rows} />
      </Panel>
      <Panel>
        <h2 className="mb-3 text-lg font-extrabold">Activity</h2>
        <ActivityHeatmap timestamps={timestamps} />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-lg font-extrabold">Puzzle Rush</h2>
          {noRush ? (
            <EmptyState icon={Icons.bolt('h-6 w-6')} title="No Rush runs yet" action={<Link to="/rush" className="font-bold text-ember-400">Play Rush</Link>} />
          ) : (
            <div className="space-y-2">
              {RUSH_LABELS.map(([k, label]) => (
                <div key={k} className="flex items-center justify-between rounded-xl bg-ink-800/70 px-4 py-3">
                  <div>
                    <div className="font-semibold">{label}</div>
                    <div className="text-xs text-ink-400">{rush[k].runs} runs · best combo ×{rush[k].bestCombo}</div>
                  </div>
                  <div className="font-mono text-2xl font-bold">{rush[k].best}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel>
          <h2 className="mb-3 text-lg font-extrabold">Puzzle Battle</h2>
          {battle.played === 0 ? (
            <EmptyState icon={Icons.swords('h-6 w-6')} title="No battles yet" action={<Link to="/battle" className="font-bold text-ember-400">Play Battle</Link>} />
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Rating" value={profile.battleRating} sub={`peak ${battle.peak ?? '–'}`} />
              <Stat label="Record" value={`${battle.wins}–${battle.losses}–${battle.draws}`} />
              <Stat label="Win rate" value={battle.winRate === null ? '–' : `${Math.round(battle.winRate * 100)}%`} />
            </div>
          )}
        </Panel>
      </div>
      <Panel>
        <AchievementGrid unlocked={data.unlocked} snapshot={data.snapshot} />
      </Panel>
    </div>
  );
}
