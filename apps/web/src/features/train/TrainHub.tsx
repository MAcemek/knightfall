import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatInterval, useReviewSummary } from '../../shared/progress/index.ts';
import { THEME_GROUPS, themeLabel } from '../../shared/themes.ts';
import { sfx } from '../../shared/fx/index.ts';
import { Button, Icons, PageHeader, Panel, Segmented } from '../../shared/ui.tsx';
import { DIFFICULTIES, MAX_THEMES, parseDifficulty, parseThemeParam, themeParam, toggleTheme, type Difficulty } from './trainLogic.ts';

const LAST_KEY = 'kf:train:last';

function readLast(): { themes: string[]; difficulty: Difficulty } {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as { themes?: unknown; difficulty?: unknown } | null;
    const themes = Array.isArray(raw?.themes) ? parseThemeParam(raw.themes.filter((t): t is string => typeof t === 'string').join('+')) : [];
    return { themes, difficulty: parseDifficulty(typeof raw?.difficulty === 'string' ? raw.difficulty : null) };
  } catch {
    return { themes: [], difficulty: 'normal' };
  }
}

/** One training mode. The whole card is the button, so on a phone it is one tap and one short row. */
function HubCard({ icon, title, text, onOpen }: { icon: (c?: string) => ReactNode; title: string; text: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx.click();
        onOpen();
      }}
      className="group flex w-full animate-rise items-center gap-3 rounded-2xl border border-ink-700/60 bg-ink-850 p-4 text-left shadow-xl shadow-black/20 transition-colors hover:border-ink-500 hover:bg-ink-800/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-ember-400">{icon('h-6 w-6')}</div>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-extrabold leading-tight">{title}</h2>
        <p className="text-sm text-ink-400">{text}</p>
      </div>
      <span className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-100">{Icons.chevRight('h-5 w-5')}</span>
    </button>
  );
}

/** /train — review queue status + theme picker. */
export function TrainHub() {
  const navigate = useNavigate();
  const summary = useReviewSummary();
  const [selected, setSelected] = useState<string[]>(() => readLast().themes);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => readLast().difficulty);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ themes: selected, difficulty }));
    } catch {
      /* ignore */
    }
  }, [selected, difficulty]);

  const startThemes = () => navigate(`/train/theme/${themeParam(selected)}?d=${difficulty}`);
  const due = summary?.due ?? 0;
  let reviewLine = '';
  if (summary) {
    if (summary.total === 0) reviewLine = 'Puzzles you miss in Puzzles, Rush or theme training, and mistakes from your analysed games, land here automatically.';
    else if (due === 0) {
      const wait = formatInterval(Math.max(60_000, (summary.nextDueAt ?? Date.now()) - Date.now()));
      reviewLine = `All caught up · ${summary.total} in rotation · next in ${wait}`;
    } else reviewLine = `${due} ready now · ${summary.total} in rotation`;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Train" subtitle="Sharpen one idea at a time. Nothing here changes your rating." icon={Icons.target('h-6 w-6')} />

      <Panel className="mb-4 flex animate-rise flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-ember-400">{Icons.layers('h-6 w-6')}</div>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold">Review mistakes</h2>
            <p className="min-h-5 text-sm text-ink-400">{reviewLine}</p>
          </div>
        </div>
        <Button variant={due ? 'primary' : 'secondary'} disabled={!due} onClick={() => navigate('/train/review')}>
          {Icons.layers('h-4 w-4')} {due ? `Review ${due}` : 'Nothing due'}
        </Button>
      </Panel>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <HubCard icon={Icons.search} title="From my games" text="Your own mistakes from analysed games, as puzzles." onOpen={() => navigate('/train/games')} />
        <HubCard icon={Icons.bulb} title="Openings" text="Learn the named lines move by move, then get tested on them." onOpen={() => navigate('/train/openings')} />
        <HubCard icon={Icons.trophy} title="Endgames" text="Play key endings against perfect defence." onOpen={() => navigate('/train/endgames')} />
        <HubCard icon={Icons.eye} title="Board vision" text="Find and name squares, plan knight routes. Quick timed drills." onOpen={() => navigate('/train/vision')} />
      </div>

      <div className="animate-rise" style={{ animationDelay: '60ms' }}>
        <Panel className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold">Theme training</h2>
            <span className="font-mono text-sm text-ink-400">
              {selected.length}/{MAX_THEMES} picked
            </span>
          </div>
          {THEME_GROUPS.map((g) => (
            <section key={g.id}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">{g.label}</h3>
              <div className="flex flex-wrap gap-2">
                {g.themes.map((t) => {
                  const on = selected.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSelected(toggleTheme(selected, t))}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold max-lg:min-h-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${on ? 'bg-ember-500 text-ink-950' : 'bg-ink-800 text-ink-200 hover:bg-ink-700'}`}
                    >
                      {themeLabel(t)}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-700/60 pt-4">
            <Segmented label="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
            <Button variant="primary" size="lg" className="max-lg:hidden" disabled={!selected.length} onClick={startThemes}>
              {Icons.target('h-5 w-5')} Start training
            </Button>
          </div>
          {selected.length ? (
            // Phones: the theme list is long, so the Start button rides along at the bottom of the screen
            // instead of waiting below the last theme.
            <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-10 -mx-4 -mb-4 rounded-b-2xl bg-ink-850/95 px-4 pb-4 pt-3 backdrop-blur lg:hidden">
              <Button variant="primary" className="h-12 w-full text-lg" onClick={startThemes}>
                {Icons.target('h-5 w-5')} Start training · {selected.length} {selected.length === 1 ? 'theme' : 'themes'}
              </Button>
            </div>
          ) : (
            <p className="min-h-5 text-sm text-ink-500">Pick one to three themes. Puzzles that match any of them are served near your rating.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
