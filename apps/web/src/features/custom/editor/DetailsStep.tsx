import { useState } from 'react';
import { sfx, TickerNumber } from '../../../shared/fx/index.ts';
import { Button, GameLayout, Icons, Panel, Pill } from '../../../shared/ui.tsx';
import { MiniBoard } from '../bits.tsx';
import { PRESET_THEMES, RATING_MAX, RATING_MIN, THEME_MAX, TITLE_MAX, cleanTheme, sideName, themeLabel, type Side } from '../logic.ts';
import { EngineCheckPanel } from './EngineCheckPanel.tsx';
import { Label } from './SetupStep.tsx';

export function ratingTier(r: number): { label: string; tone: string } {
  if (r < 1000) return { label: 'Beginner', tone: 'text-good-400' };
  if (r < 1400) return { label: 'Casual', tone: 'text-sky-400' };
  if (r < 1800) return { label: 'Intermediate', tone: 'text-ember-300' };
  if (r < 2200) return { label: 'Advanced', tone: 'text-ember-500' };
  return { label: 'Master', tone: 'text-violet-400' };
}

export interface DetailsStepProps {
  fen: string;
  moves: string[];
  opponentFirst: boolean;
  orientation: 'white' | 'black';
  solver: Side;
  solverMoves: number;
  endsInMate: boolean;
  title: string;
  setTitle: (t: string) => void;
  themes: string[];
  setThemes: (t: string[]) => void;
  rating: number;
  setRating: (r: number) => void;
  isEdit: boolean;
  saving: boolean;
  onBack: () => void;
  onSave: (thenPlay: boolean) => void;
}

export function DetailsStep(p: DetailsStepProps) {
  const [custom, setCustom] = useState('');
  const tier = ratingTier(p.rating);
  const extra = p.themes.filter((t) => !(PRESET_THEMES as readonly string[]).includes(t));
  const full = p.themes.length >= THEME_MAX;

  const toggle = (t: string) => {
    if (p.themes.includes(t)) p.setThemes(p.themes.filter((x) => x !== t));
    else if (!full) p.setThemes([...p.themes, t]);
    sfx.click();
  };

  const addCustom = () => {
    const t = cleanTheme(custom);
    if (!t || full) return;
    if (!p.themes.some((x) => x.toLowerCase() === t.toLowerCase())) p.setThemes([...p.themes, t]);
    setCustom('');
    sfx.correct();
  };

  return (
    <GameLayout
      board={
        <div className="relative">
          <MiniBoard fen={p.fen} orientation={p.orientation} />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-300">
            <Pill>
              <span className={`h-2.5 w-2.5 rounded-sm ${p.solver === 'w' ? 'bg-ink-100' : 'bg-ink-950 ring-1 ring-ink-400'}`} />
              {sideName(p.solver)} to solve
            </Pill>
            <Pill>
              {p.solverMoves} move{p.solverMoves === 1 ? '' : 's'}
            </Pill>
            {p.endsInMate && <Pill className="bg-ember-500/20 text-ember-300">Ends in mate</Pill>}
          </div>
        </div>
      }
      side={
        <Panel className="space-y-5">
          <div>
            <Label>Title</Label>
            <input
              value={p.title}
              maxLength={TITLE_MAX}
              onChange={(e) => p.setTitle(e.target.value)}
              placeholder="e.g. The quiet rook lift"
              className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 font-semibold text-ink-100 outline-none transition placeholder:font-normal placeholder:text-ink-500 focus:border-ember-500"
            />
            <div className="mt-1 text-right text-[11px] text-ink-500">
              {p.title.length}/{TITLE_MAX}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <Label>Themes</Label>
              <span className="text-[11px] text-ink-500">
                {p.themes.length}/{THEME_MAX}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[...PRESET_THEMES, ...extra].map((t) => {
                const on = p.themes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggle(t)}
                    disabled={!on && full}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition duration-100 active:scale-90 disabled:opacity-40 ${
                      on ? 'bg-ember-500 text-ink-950 shadow-[0_2px_0_0_var(--color-ember-600)]' : 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-ink-100'
                    }`}
                    aria-pressed={on}
                  >
                    {on && '✓ '}
                    {themeLabel(t)}
                  </button>
                );
              })}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addCustom();
              }}
            >
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                maxLength={24}
                placeholder="Add your own theme"
                disabled={full}
                className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-ember-500"
              />
              <Button size="sm" type="submit" disabled={!cleanTheme(custom) || full}>
                Add
              </Button>
            </form>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <Label>Difficulty</Label>
              <span className={`text-xs font-bold ${tier.tone}`}>{tier.label}</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={RATING_MIN}
                max={RATING_MAX}
                step={25}
                value={p.rating}
                onChange={(e) => {
                  p.setRating(Number(e.target.value));
                  if (Number(e.target.value) % 100 === 0) sfx.tick();
                }}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-[var(--color-ember-500)]"
                aria-label="Difficulty rating"
              />
              <TickerNumber value={p.rating} duration={0.25} className="inline-block w-14 text-right font-mono text-2xl font-black text-ink-100" />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-ink-500">
              <span>{RATING_MIN}</span>
              <span>{RATING_MAX}</span>
            </div>
          </div>

          <EngineCheckPanel fen={p.fen} moves={p.moves} opponentFirst={p.opponentFirst} />

          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button size="lg" onClick={p.onBack} aria-label="Back to solution">
              {Icons.next('h-5 w-5 rotate-180')}
            </Button>
            <Button variant="good" size="lg" onClick={() => p.onSave(false)} disabled={p.saving}>
              {Icons.check('h-5 w-5')} {p.isEdit ? 'Save changes' : 'Save puzzle'}
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => p.onSave(true)} disabled={p.saving}>
            Save &amp; play it now {Icons.next('h-4 w-4')}
          </Button>
        </Panel>
      }
    />
  );
}
