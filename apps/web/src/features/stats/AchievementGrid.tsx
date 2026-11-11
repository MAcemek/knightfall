import { Icons } from '../../shared/ui.tsx';
import { ACHIEVEMENTS, achievementProgress } from '../../shared/progress/index.ts';
import type { ProgressSnapshot } from '../../shared/progress/index.ts';
import type { AchievementRow } from '../../shared/db.ts';

const TIER = {
  bronze: 'bg-sky-400/15 text-sky-400',
  silver: 'bg-violet-400/15 text-violet-400',
  gold: 'bg-ember-500/15 text-ember-400',
} as const;

export function AchievementGrid({ unlocked, snapshot }: { unlocked: AchievementRow[]; snapshot: ProgressSnapshot }) {
  const at = new Map(unlocked.map((u) => [u.id, u.at]));
  const count = ACHIEVEMENTS.filter((a) => at.has(a.id)).length;
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold">Achievements</h2>
        <span className="font-mono text-sm text-ink-400">{count} / {ACHIEVEMENTS.length}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ACHIEVEMENTS.map((a, i) => {
          const when = at.get(a.id);
          const prog = when === undefined ? achievementProgress(a, snapshot) : null;
          return (
            <div
              key={a.id}
              className={`flex animate-rise items-center gap-3 rounded-2xl border p-3.5 ${when !== undefined ? 'border-ink-700 bg-ink-850' : 'border-ink-800 bg-ink-900/60 opacity-70'}`}
              style={{ animationDelay: `${i * 25}ms` }}
            >
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${when !== undefined ? TIER[a.tier] : 'bg-ink-800 text-ink-500'}`}>
                {when !== undefined ? Icons[a.icon]('h-5 w-5') : Icons.lock('h-5 w-5')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-extrabold">{a.title}</div>
                <div className="text-xs text-ink-400">{a.desc}</div>
                {when !== undefined ? (
                  <div className="text-[11px] text-ink-500">Unlocked {new Date(when).toLocaleDateString()}</div>
                ) : (
                  prog && (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
                        <div className="h-full rounded-full bg-ember-500" style={{ width: `${Math.round(prog.ratio * 100)}%` }} />
                      </div>
                      <span className="font-mono text-[11px] text-ink-400">{prog.value} / {prog.target}</span>
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
