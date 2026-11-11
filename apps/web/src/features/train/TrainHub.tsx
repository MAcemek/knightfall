import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatInterval, useReviewSummary } from '../../shared/progress/index.ts';
import { THEME_GROUPS, themeLabel } from '../../shared/themes.ts';
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

  const due = summary?.due ?? 0;
  let reviewLine = '';
  if (summary) {
    if (summary.total === 0) reviewLine = 'Puzzles you miss in Puzzles, Rush or theme training land here automatically.';
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
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${on ? 'bg-ember-500 text-ink-950' : 'bg-ink-800 text-ink-200 hover:bg-ink-700'}`}
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
            <Button variant="primary" size="lg" disabled={!selected.length} onClick={() => navigate(`/train/theme/${themeParam(selected)}?d=${difficulty}`)}>
              {Icons.target('h-5 w-5')} Start training
            </Button>
          </div>
          <p className="min-h-5 text-sm text-ink-500">{selected.length ? '' : 'Pick one to three themes. Puzzles that match any of them are served near your rating.'}</p>
        </Panel>
      </div>
    </div>
  );
}
