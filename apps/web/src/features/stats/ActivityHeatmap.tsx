import { useMemo } from 'react';
import { activeDayStreak, activityGrid } from './statsLogic.ts';

const LEVEL = ['bg-ink-800', 'bg-ember-600/35', 'bg-ember-600/65', 'bg-ember-500', 'bg-ember-300'] as const;

export function ActivityHeatmap({ timestamps }: { timestamps: number[] }) {
  const grid = useMemo(() => activityGrid(timestamps, new Date(), 18), [timestamps]);
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {grid.map((col, w) => (
          <div key={w} className="flex flex-col gap-1">
            {col.map((cell, d) =>
              cell ? (
                <div
                  key={d}
                  className={`h-3.5 w-3.5 rounded-[4px] ${LEVEL[cell.level]}`}
                  title={`${cell.date} · ${cell.count} puzzle${cell.count === 1 ? '' : 's'}`}
                />
              ) : (
                <div key={d} className="h-3.5 w-3.5" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-500">
        <span>Less</span>
        {LEVEL.map((c) => <div key={c} className={`h-3 w-3 rounded-[3px] ${c}`} />)}
        <span>More</span>
        <span className="ml-auto font-mono text-sm text-ember-400">{activeDayStreak(timestamps, new Date())}-day streak</span>
      </div>
    </div>
  );
}
