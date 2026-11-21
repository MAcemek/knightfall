import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getKV, setKV } from '../../shared/db.ts';
import { Button, EmptyState, Icons, PageHeader, Panel, Pill, Segmented } from '../../shared/ui.tsx';
import {
  familyStats, isChosen, OPENING_FAMILIES_KEY, progressMap, sanitizeChosen, searchFamilies, toggleChosen,
  type ChosenFamily, type OpeningFamily, type Side,
} from './openingLogic.ts';
import { useOpeningData } from './useOpeningData.ts';

const SIDES = [
  { id: 'w', label: 'White' },
  { id: 'b', label: 'Black' },
] as const;

/** Show this many search results at once; the search box narrows the rest. */
const MAX_RESULTS = 40;

export function drillPath(name: string, color: Side): string {
  return `/train/openings/drill?${new URLSearchParams({ f: name, c: color }).toString()}`;
}

/** /train/openings: searchable family list with a colour toggle, plus "My openings". */
export function OpeningsHome() {
  const navigate = useNavigate();
  const state = useOpeningData();
  const [color, setColor] = useState<Side>('w');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<ChosenFamily[] | null>(null);
  const rows = useLiveQuery(() => db.openingLines.toArray(), []);
  const progress = useMemo(() => progressMap(rows ?? []), [rows]);

  useEffect(() => {
    let live = true;
    void getKV<unknown>(OPENING_FAMILIES_KEY, []).then((raw) => {
      if (live) setChosen(sanitizeChosen(raw));
    });
    return () => {
      live = false;
    };
  }, []);

  const families = state.status === 'ready' ? state.data.families : null;
  const byName = useMemo(() => new Map((families ?? []).map((f) => [f.name, f])), [families]);
  const results = useMemo(() => (families ? searchFamilies(families, query, color) : []), [families, query, color]);

  function toggle(name: string, side: Side) {
    const next = toggleChosen(chosen ?? [], name, side);
    setChosen(next);
    void setKV(OPENING_FAMILIES_KEY, next);
  }

  const now = Date.now();
  const mine = (chosen ?? []).filter((c) => byName.has(c.name));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Openings" subtitle="Pick openings, then play their named lines move by move." icon={Icons.layers('h-6 w-6')} />

      {state.status === 'error' && (
        <EmptyState icon={Icons.help('h-6 w-6')} title="Could not load the openings">
          The opening list could not be loaded. Check your connection and reload.
        </EmptyState>
      )}
      {state.status === 'loading' && <p className="text-sm text-ink-400">Loading openings…</p>}

      {families && (
        <>
          <Panel className="mb-4 animate-rise">
            <h2 className="mb-3 text-lg font-extrabold">My openings</h2>
            {mine.length === 0 ? (
              <p className="text-sm text-ink-400">Choose an opening below to add it here, with how many lines are due.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {mine.map((c) => {
                  const fam = byName.get(c.name) as OpeningFamily;
                  const s = familyStats(fam, c.color, progress, now);
                  const todo = s.due + s.fresh;
                  return (
                    <li key={`${c.name}:${c.color}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-800/70 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate font-bold">{c.name}</div>
                        <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-ink-400">
                          <Pill>{c.color === 'w' ? 'White' : 'Black'}</Pill>
                          {s.due > 0 && <Pill className="bg-ember-500/15 text-ember-400">{s.due} due</Pill>}
                          <Pill>{s.fresh} new</Pill>
                          <Pill>{s.learned} of {s.total} learned</Pill>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant={todo ? 'primary' : 'secondary'} size="sm" onClick={() => navigate(drillPath(c.name, c.color))}>
                          {Icons.next('h-4 w-4')} Practise
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${c.name} as ${c.color === 'w' ? 'White' : 'Black'}`}
                          onClick={() => toggle(c.name, c.color)}
                        >
                          {Icons.x('h-4 w-4')}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel className="animate-rise">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold">All openings</h2>
              <Segmented options={SIDES} value={color} onChange={setColor} label="Play as" />
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search openings or ECO (C50)"
              aria-label="Search openings"
              className="mb-3 h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-3 text-base text-ink-100 placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
            />
            {results.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-400">No opening matches.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {results.slice(0, MAX_RESULTS).map((f) => {
                  const on = isChosen(chosen ?? [], f.name, color);
                  const s = familyStats(f, color, progress, now);
                  return (
                    <li key={f.name} className="flex items-center justify-between gap-3 rounded-xl bg-ink-800/50 px-3 py-1.5">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{f.name}</div>
                        <div className="text-xs text-ink-400">
                          {f.eco} · {s.total} line{s.total === 1 ? '' : 's'}
                        </div>
                      </div>
                      <Button variant={on ? 'good' : 'secondary'} size="sm" disabled={chosen === null} onClick={() => toggle(f.name, color)} aria-pressed={on}>
                        {on ? (
                          <>
                            {Icons.check('h-4 w-4')} Added
                          </>
                        ) : (
                          'Add'
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {results.length > MAX_RESULTS && (
              <p className="mt-3 text-center text-xs text-ink-400">Showing {MAX_RESULTS} of {results.length}. Search to narrow the list.</p>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
