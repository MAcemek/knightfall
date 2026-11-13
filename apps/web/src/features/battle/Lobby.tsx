import { useEffect, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BATTLE_DURATION_MS, BATTLE_MAX_STRIKES } from '@knightfall/core';
import { db, type BattleRecord } from '../../shared/db.ts';
import { useProfile } from '../../shared/profile.ts';
import { TickerNumber } from '../../shared/fx/index.ts';
import { Button, Icons, Panel, Pill } from '../../shared/ui.tsx';
import type { BattleApi } from './useBattle.ts';
import { formatClock, isInteractiveTarget, isTypingTarget, timeAgo, useNow } from './util.ts';

const RESULT_STYLE: Record<BattleRecord['result'], { letter: string; cls: string }> = {
  win: { letter: 'W', cls: 'bg-good-500/15 text-good-400 ring-good-500/40' },
  loss: { letter: 'L', cls: 'bg-bad-500/15 text-bad-400 ring-bad-500/40' },
  draw: { letter: 'D', cls: 'bg-ink-600/40 text-ink-200 ring-ink-500/50' },
};

function tally(battles: BattleRecord[]) {
  const r = { win: 0, loss: 0, draw: 0, best: 0 };
  for (const b of battles) {
    r[b.result]++;
    r.best = Math.max(r.best, b.you.solved);
  }
  return r;
}

/** Lobby: rating, record, recent battles, and the big "Find opponent" button (or the searching state). */
export function Lobby({ api }: { api: BattleApi }) {
  const { state } = api;
  const profile = useProfile();
  const all = useLiveQuery(() => db.battles.orderBy('at').reverse().toArray(), []);
  const recent = useMemo(() => all?.slice(0, 12), [all]);
  const searching = state.phase === 'searching' || state.phase === 'connecting';

  // Career totals (hero pills) over every battle; the side panel lists the latest 12.
  const record = useMemo(() => tally(all ?? []), [all]);
  const recentRecord = useMemo(() => tally(recent ?? []), [recent]);

  // Enter/Space = find, Escape = cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.repeat) return;
      if (searching && e.key === 'Escape') {
        e.preventDefault();
        api.cancel();
      } else if (!searching && (e.key === 'Enter' || e.key === ' ') && !isInteractiveTarget(e.target)) {
        e.preventDefault();
        api.findOpponent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, searching]);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {state.error && (
          <div className="flex animate-pop items-center justify-between gap-3 rounded-2xl border border-bad-500/40 bg-bad-500/10 px-4 py-3 text-sm font-semibold text-bad-400" role="alert">
            <span className="flex items-center gap-2">
              {Icons.x('h-4 w-4 shrink-0')}
              {state.error}
            </span>
            <button className="text-ink-300 hover:text-ink-100" onClick={api.clearError} aria-label="Dismiss">
              {Icons.x('h-4 w-4')}
            </button>
          </div>
        )}

        <Panel className="relative overflow-hidden p-0">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-ember-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
          {searching ? <Searching api={api} /> : <Hero api={api} rating={profile?.battleRating} record={record} />}
        </Panel>

        <Panel>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-ink-400">How it works</h2>
          <ul className="grid gap-3 text-sm text-ink-300 sm:grid-cols-3">
            <Rule icon={Icons.swords('h-5 w-5')} title="Same puzzles">
              You and your rival race through an identical set that gets harder as you go.
            </Rule>
            <Rule icon={Icons.clock('h-5 w-5')} title={`${formatClock(BATTLE_DURATION_MS)} on the clock`}>
              Most puzzles solved when time runs out wins the battle.
            </Rule>
            <Rule icon={Icons.x('h-5 w-5')} title={`${BATTLE_MAX_STRIKES} strikes`}>
              Each miss is a strike. Three and you're out — your score stands.
            </Rule>
          </ul>
        </Panel>
      </div>

      <Panel className="h-fit">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink-400">Recent battles</h2>
          {recent && recent.length > 0 && (
            <span className="font-mono text-xs text-ink-400">
              <span className="text-good-400">{recentRecord.win}W</span> · <span className="text-bad-400">{recentRecord.loss}L</span> · {recentRecord.draw}D
            </span>
          )}
        </div>
        {!recent ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-ink-800/60" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-ink-400">
            No battles yet. Your first rival is one click away.
          </div>
        ) : (
          <ul className="space-y-2">
            {recent.map((b) => (
              <RecentRow key={b.id} b={b} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Hero({ api, rating, record }: { api: BattleApi; rating: number | undefined; record: { win: number; loss: number; draw: number; best: number } }) {
  return (
    <div className="relative flex flex-col items-center gap-5 px-5 py-8 text-center sm:py-10">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-400 to-ember-600 text-ink-950 shadow-[0_0_40px_rgb(255_154_31/0.35)]">
        {Icons.swords('h-9 w-9')}
      </div>
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-ink-400">Battle rating</div>
        <div className="font-mono text-5xl font-black text-ink-100">{rating === undefined ? '—' : <TickerNumber value={rating} />}</div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Pill className="bg-good-500/15 text-good-400">{record.win} wins</Pill>
        <Pill className="bg-bad-500/15 text-bad-400">{record.loss} losses</Pill>
        <Pill>{record.draw} draws</Pill>
        {record.best > 0 && <Pill className="bg-ember-500/15 text-ember-300">Best score {record.best}</Pill>}
      </div>
      <Button variant="primary" size="lg" className="w-full max-w-xs" onClick={api.findOpponent} autoFocus>
        {Icons.swords('h-5 w-5')} Find opponent
      </Button>
      <div className="text-xs text-ink-500">
        Press <Kbd>Enter</Kbd> to start searching
      </div>
    </div>
  );
}

function Searching({ api }: { api: BattleApi }) {
  const { state } = api;
  const now = useNow(250);
  const elapsed = state.phase === 'searching' && state.queuedAt ? now - state.queuedAt : 0;
  return (
    <div className="relative flex flex-col items-center gap-5 px-5 py-8 text-center sm:py-10" aria-live="polite">
      <div className="relative flex h-28 w-28 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-ember-500/20 [animation-duration:1.6s]" />
        <span className="absolute inset-3 animate-ping rounded-full bg-ember-500/25 [animation-delay:0.4s] [animation-duration:1.6s]" />
        <span className="absolute inset-0 rounded-full ring-2 ring-ember-500/30" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-ember-400 to-ember-600 text-ink-950 shadow-[0_0_40px_rgb(255_154_31/0.45)]">
          {Icons.swords('h-8 w-8')}
        </div>
      </div>
      <div>
        <div className="text-xl font-extrabold">{state.phase === 'connecting' ? 'Connecting…' : 'Searching for an opponent…'}</div>
        <div className="mt-1 font-mono text-3xl font-bold tabular text-ember-400">{formatClock(elapsed)}</div>
        <div className="mt-2 text-sm text-ink-400">
          {state.phase === 'connecting'
            ? now - state.connectingSince > 4000
              ? 'Waking up the battle server. This can take up to a minute.'
              : 'Reaching the battle server.'
            : elapsed > 5000
              ? 'No rival yet — a sparring bot will step in shortly.'
              : 'Matching you with someone near your rating.'}
        </div>
      </div>
      <Button variant="secondary" onClick={api.cancel}>
        Cancel
      </Button>
      <div className="text-xs text-ink-500">
        <Kbd>Esc</Kbd> to cancel
      </div>
    </div>
  );
}

function RecentRow({ b }: { b: BattleRecord }) {
  const st = RESULT_STYLE[b.result];
  const delta = b.ratingAfter - b.ratingBefore;
  return (
    <li className="flex items-center gap-3 rounded-xl bg-ink-800/60 px-3 py-2.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-black ring-1 ${st.cls}`}>{st.letter}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {b.opponentName} <span className="font-mono text-xs text-ink-400">({b.opponentRating})</span>
        </div>
        <div className="text-xs text-ink-400">
          {timeAgo(b.at)}
          {b.reason === 'opponent-left' && ' · opponent left'}
          {b.reason === 'resigned' && ' · resigned'}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm font-bold">
          {b.you.solved}–{b.opponent.solved}
        </div>
        <div className={`font-mono text-xs font-semibold ${delta > 0 ? 'text-good-400' : delta < 0 ? 'text-bad-400' : 'text-ink-400'}`}>
          {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0'}
        </div>
      </div>
    </li>
  );
}

function Rule({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-xl bg-ink-800/50 p-3">
      <span className="mt-0.5 text-ember-400">{icon}</span>
      <span>
        <span className="block font-bold text-ink-100">{title}</span>
        {children}
      </span>
    </li>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300">{children}</kbd>;
}
