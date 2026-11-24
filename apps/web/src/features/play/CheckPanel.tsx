import { Button, Kbd } from '../../shared/ui.tsx';
import { allTicked, CHECK_ITEMS, type CheckId, type Ticks } from './playLogic.ts';

/**
 * The blunder check: the move is on the board but not played yet. Three questions to answer in your head,
 * then Play. The question text is the label, so a screen reader reads it with the box.
 */
export function CheckPanel({ san, ticks, onToggle, onPlay, onTakeBack }: {
  san: string;
  ticks: Ticks;
  onToggle: (id: CheckId) => void;
  onPlay: () => void;
  onTakeBack: () => void;
}) {
  const ready = allTicked(ticks);
  return (
    <div className="animate-rise rounded-2xl border border-ink-700/60 bg-ink-850 p-2 shadow-xl shadow-black/20 lg:p-3">
      <p className="mb-1 truncate text-xs font-bold text-ink-200 lg:mb-1.5 lg:text-sm">
        Your move <span className="font-mono text-ember-400">{san}</span> is not played yet
      </p>
      <fieldset>
        <legend className="sr-only">Blunder check: tick each one once you have looked</legend>
        <div className="grid grid-cols-3 gap-1.5">
          {CHECK_ITEMS.map((c) => (
            <label
              key={c.id}
              className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-xl border px-2 py-1 max-lg:justify-center max-lg:gap-1 max-lg:px-1 lg:items-start lg:py-1.5 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ember-400 ${ticks[c.id] ? 'border-good-500/60 bg-good-500/10' : 'border-ink-700 bg-ink-900 hover:border-ink-500'}`}
            >
              <input
                type="checkbox"
                checked={ticks[c.id]}
                onChange={() => onToggle(c.id)}
                className="mt-0.5 h-5 w-5 shrink-0 max-lg:h-4 max-lg:w-4 accent-[var(--color-ember-500)]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-bold leading-tight max-lg:text-xs">
                  {c.word}
                  <span className="hidden lg:inline">
                    <Kbd>{c.key}</Kbd>
                  </span>
                </span>
                <span className="sr-only text-[11px] leading-tight text-ink-400 lg:not-sr-only lg:block">{c.question}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-1.5 grid grid-cols-2 gap-2 lg:mt-2">
        <Button variant="secondary" onClick={onTakeBack} aria-keyshortcuts="Escape">
          Take back
        </Button>
        <Button variant="primary" onClick={onPlay} disabled={!ready} aria-keyshortcuts="Enter">
          Play
        </Button>
      </div>
      <p className="mt-1.5 hidden text-xs text-ink-500 lg:block">
        {ready ? 'Press Enter to play or Escape to take it back.' : 'Tick all three to play. Press 1, 2 or 3.'}
      </p>
    </div>
  );
}
