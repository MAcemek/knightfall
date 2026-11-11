import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isTrainableTheme, themeLabel } from '../../shared/themes.ts';
import { Button, EmptyState, Icons } from '../../shared/ui.tsx';
import { strengthsAndWeaknesses, themeAccuracy } from './statsLogic.ts';
import type { ThemeStat } from './statsLogic.ts';

function ThemeRow({ stat, tone, index }: { stat: ThemeStat; tone: 'good' | 'bad'; index: number }) {
  return (
    <div className="flex animate-rise items-center gap-3" style={{ animationDelay: `${index * 50}ms` }}>
      <span className="w-36 shrink-0 truncate font-semibold">{themeLabel(stat.theme)}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-800">
        <div
          className={`h-full origin-left animate-bar-grow rounded-full ${tone === 'good' ? 'bg-good-500' : 'bg-bad-500'}`}
          style={{ width: `${Math.round(stat.accuracy * 100)}%` }}
        />
      </div>
      <span className="w-20 text-right font-mono text-sm tabular">
        {Math.round(stat.accuracy * 100)}% <span className="text-ink-500">· {stat.attempts}</span>
      </span>
      {tone === 'bad' && isTrainableTheme(stat.theme) && (
        <Link to={`/train/theme/${stat.theme}`} className="text-xs font-bold text-ember-400 hover:underline">Train</Link>
      )}
    </div>
  );
}

export function ThemeBreakdown({ rows }: { rows: { themes: string[]; solved: boolean }[] | undefined }) {
  const stats = useMemo(() => (rows ? themeAccuracy(rows) : []), [rows]);
  const [showAll, setShowAll] = useState(false);
  if (rows === undefined) return <p className="text-sm text-ink-400">Crunching your history…</p>;
  if (stats.length === 0) {
    return (
      <EmptyState icon={Icons.target('h-6 w-6')} title="Not enough data yet">
        Themes show up once you have tried at least five puzzles of a kind.
      </EmptyState>
    );
  }
  const { strengths, weaknesses } = strengthsAndWeaknesses(stats, 3);
  return (
    <div className="space-y-4">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2.5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-good-400">Strengths</h3>
          {strengths.map((s, i) => <ThemeRow key={s.theme} stat={s} tone="good" index={i} />)}
        </div>
        <div className="space-y-2.5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-bad-400">Needs work</h3>
          {weaknesses.length === 0 ? (
            <p className="text-sm text-ink-500">Keep playing to reveal weak spots.</p>
          ) : (
            weaknesses.map((s, i) => <ThemeRow key={s.theme} stat={s} tone="bad" index={i} />)
          )}
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
        {showAll ? 'Hide' : `Show all ${stats.length} themes`}
      </Button>
      {showAll && (
        <div className="space-y-2.5">
          {stats.map((s, i) => <ThemeRow key={s.theme} stat={s} tone={s.accuracy >= 0.6 ? 'good' : 'bad'} index={i} />)}
        </div>
      )}
    </div>
  );
}
