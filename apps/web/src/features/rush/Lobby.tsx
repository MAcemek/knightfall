import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type RushMode } from '../../shared/db.ts';
import { sfx } from '../../shared/fx/index.ts';
import { Button, Icons, PageHeader, Panel } from '../../shared/ui.tsx';
import { MAX_STRIKES, MODE_ORDER, modeHistory, RUSH_MODES, type ModeHistory } from './rushLogic.ts';

const LAST_MODE_KEY = 'kf:rush:mode';

export function readLastMode(): RushMode {
  try {
    const v = localStorage.getItem(LAST_MODE_KEY);
    if (v === '3min' || v === '5min' || v === 'survival') return v;
  } catch {
    /* storage unavailable */
  }
  return '3min';
}

function writeLastMode(m: RushMode) {
  try {
    localStorage.setItem(LAST_MODE_KEY, m);
  } catch {
    /* storage unavailable */
  }
}

const MODE_ICON: Record<RushMode, (c?: string) => ReactNode> = {
  '3min': Icons.bolt,
  '5min': Icons.clock,
  survival: Icons.flame,
};

/** Tiny bar chart of the last five scores (newest on the right). */
function RecentBars({ scores, best }: { scores: number[]; best: number | null }) {
  const ordered = [...scores].reverse();
  const max = Math.max(1, best ?? 0, ...scores);
  return (
    <div className="flex h-14 items-end gap-1.5">
      {Array.from({ length: 5 }, (_, i) => {
        const v = ordered[i];
        if (v === undefined) return <div key={i} className="h-1.5 flex-1 rounded-sm bg-ink-700/60" />;
        const isBest = best !== null && v === best && v > 0;
        return (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className={`font-mono text-[10px] font-bold leading-none tabular ${isBest ? 'text-ember-300' : 'text-ink-400'}`}>{v}</span>
            <div
              className={`w-full rounded-sm transition-[height] duration-500 ${isBest ? 'bg-ember-400' : 'bg-ink-500'}`}
              style={{ height: `${Math.max(6, (v / max) * 36)}px` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function ModeCard({ mode, hist, selected, hotkey, onSelect, onStart }: {
  mode: RushMode;
  hist: ModeHistory | undefined;
  selected: boolean;
  hotkey: number;
  onSelect: () => void;
  onStart: () => void;
}) {
  const cfg = RUSH_MODES[mode];
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onStart}
      aria-pressed={selected}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border p-4 text-left transition duration-150 sm:p-5 ${
        selected
          ? 'border-ember-400/80 bg-ink-800 shadow-[0_0_0_1px_rgb(255_180_84/0.5),0_12px_40px_-12px_rgb(255_154_31/0.45)]'
          : 'border-ink-700/60 bg-ink-850 hover:-translate-y-0.5 hover:border-ink-500 hover:bg-ink-800/70'
      }`}
    >
      {selected && <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-ember-500/20 blur-2xl" />}
      <div className="relative flex items-start justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${selected ? 'bg-ember-500 text-ink-950' : 'bg-ink-700 text-ember-400 group-hover:bg-ink-600'}`}>
          {MODE_ICON[mode]('h-6 w-6')}
        </div>
        <kbd className="hidden rounded-md border border-ink-600 px-1.5 py-0.5 font-mono text-[11px] text-ink-400 sm:inline">{hotkey}</kbd>
      </div>
      <div className="relative mt-3 text-xl font-extrabold tracking-tight">{cfg.label}</div>
      <div className="relative mt-0.5 min-h-10 text-sm text-ink-400">{cfg.blurb}</div>

      <div className="relative mt-4 flex items-end justify-between gap-3 border-t border-ink-700/60 pt-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Best</div>
          <div className={`flex items-center gap-1.5 font-mono text-3xl font-black tabular ${hist?.best ? 'text-ember-400' : 'text-ink-600'}`}>
            {hist?.best ? Icons.trophy('h-5 w-5') : null}
            {hist?.best ?? '–'}
          </div>
          <div className="text-[11px] text-ink-500">{hist?.runs ? `${hist.runs} ${hist.runs === 1 ? 'run' : 'runs'}` : 'Not played yet'}</div>
        </div>
        <div className="w-28 shrink-0">
          <div className="mb-1 text-right text-[11px] font-bold uppercase tracking-wider text-ink-400">Last 5</div>
          <RecentBars scores={hist?.last ?? []} best={hist?.best ?? null} />
        </div>
      </div>
    </button>
  );
}

const RULES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: Icons.check('h-5 w-5'), title: 'Solve to score', text: 'Every solved puzzle is +1. Chain them for a combo.' },
  { icon: Icons.x('h-5 w-5'), title: `${MAX_STRIKES} strikes`, text: 'One wrong move fails the puzzle. Three misses ends the run.' },
  { icon: Icons.bolt('h-5 w-5'), title: 'It gets harder', text: 'Puzzles start easy and climb in rating as you go.' },
];

export function Lobby() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<RushMode>(readLastMode);
  const runs = useLiveQuery(() => db.rushRuns.toArray(), []);
  const history = useMemo(() => {
    if (!runs) return undefined;
    return Object.fromEntries(MODE_ORDER.map((m) => [m, modeHistory(runs, m)])) as Record<RushMode, ModeHistory>;
  }, [runs]);

  const select = (m: RushMode) => {
    if (m !== mode) sfx.click();
    setMode(m);
    writeLastMode(m);
  };
  const start = (m: RushMode = mode) => {
    writeLastMode(m);
    navigate(`/rush/play/${m}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= MODE_ORDER.length) {
        select(MODE_ORDER[n - 1]);
      } else if (e.key === 'Enter') {
        // preventDefault also stops a focused card/button from handling the same Enter.
        e.preventDefault();
        sfx.click();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const totalRuns = runs?.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Puzzle Rush"
        subtitle="Race the clock. Solve as many as you can."
        icon={Icons.bolt('h-6 w-6')}
        right={totalRuns > 0 ? <span className="text-sm text-ink-400">{totalRuns} runs played</span> : undefined}
      />

      <div className="grid gap-3 md:grid-cols-3">
        {MODE_ORDER.map((m, i) => (
          <ModeCard
            key={m}
            mode={m}
            hist={history?.[m]}
            selected={mode === m}
            hotkey={i + 1}
            onSelect={() => select(m)}
            onStart={() => start(m)}
          />
        ))}
      </div>

      <div className="mt-5 flex flex-col items-center gap-2">
        <Button variant="primary" size="lg" className="w-full max-w-sm text-xl" onClick={() => start()}>
          {Icons.bolt('h-6 w-6')} Start {RUSH_MODES[mode].label}
        </Button>
        <div className="hidden text-xs text-ink-500 sm:block">Press 1–3 to pick a mode · Enter to start</div>
      </div>

      <Panel className="mt-6 grid gap-4 sm:grid-cols-3">
        {RULES.map((r) => (
          <div key={r.title} className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-ember-400">{r.icon}</div>
            <div>
              <div className="font-bold">{r.title}</div>
              <div className="text-sm text-ink-400">{r.text}</div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
