import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Panel } from '../../shared/ui.tsx';
import type { CoachSync } from './useCoachSync.ts';
import { addBlitz, undoBlitz, type StopState } from './stopStore.ts';
import { agoText, bulletLine } from './todayText.ts';

/** The bullet and blitz stop-rule cards and the sync line on the Today page. */

const STATE_COLOR = { ok: 'text-ink-100', near: 'text-ember-400', full: 'text-bad-400' } as const;

export function StopCards({ stop, today, hasUser }: { stop: StopState | undefined; today: string; hasUser: boolean }) {
  if (!stop) return null;
  const { bullet, blitz, notes } = stop;
  const shown = blitz.results.slice(-8);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Panel>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-400">Bullet this week</h2>
        <div className={`mt-1 font-mono text-2xl font-bold ${STATE_COLOR[bullet.state]}`}>
          {bullet.count} of {bullet.limit}
        </div>
        <p className="mt-1 text-sm text-ink-300">{bulletLine(bullet)}</p>
        {!hasUser && (
          <p className="mt-2 text-sm text-ink-400">
            Bullet games are counted from chess.com. Add your username in <Link to="/coach/settings" className="font-semibold text-ember-400 underline">Plan settings</Link>.
          </p>
        )}
      </Panel>
      <Panel>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-400">Blitz today</h2>
        <p className="mt-1 text-sm text-ink-300" aria-label="Blitz results today">
          {shown.length === 0 ? 'No games yet today.' : shown.map((r) => (r === 'win' ? 'W' : r === 'loss' ? 'L' : 'D')).join(' ')}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="good" onClick={() => void addBlitz(today, 'win')}>
            Win
          </Button>
          <Button size="sm" variant="danger" onClick={() => void addBlitz(today, 'loss')}>
            Loss
          </Button>
          <Button size="sm" variant="ghost" disabled={notes.length === 0} onClick={() => void undoBlitz(today)}>
            Undo
          </Button>
        </div>
        <p className={blitz.stop ? 'mt-3 rounded-xl border border-bad-500/40 bg-bad-500/10 px-3 py-2 font-bold text-bad-400' : 'sr-only'} role="status">
          {blitz.stop ? 'Two losses in a row. Stop for today.' : ''}
        </p>
      </Panel>
    </div>
  );
}

export function SyncLine({ lastSync, sync, hasUser }: { lastSync: number | null; sync: CoachSync; hasUser: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!hasUser) return <p className="text-sm text-ink-400">No chess.com username in the plan, so nothing is synced.</p>;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-400">
      <span>{sync.busy ? 'Syncing with chess.com' : agoText(lastSync, now)}</span>
      <Button size="sm" variant="ghost" disabled={sync.busy} onClick={() => sync.run(true)}>
        Sync
      </Button>
      <span role="status" className={sync.failed ? 'text-bad-400' : 'text-ink-400'}>
        {sync.note ?? ''}
      </span>
    </div>
  );
}
