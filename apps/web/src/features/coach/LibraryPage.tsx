import { Panel } from '../../shared/ui.tsx';
import { entriesOf, LIBRARY_GROUPS } from './libraryLogic.ts';
import { toggleLibrary, useLibraryTicks } from './notesStore.ts';

/** /coach/library: videos, books and tools, with a tick for the ones you have used. */

export function LibraryPage() {
  const ticks = useLibraryTicks();
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-300">Links open other sites in a new tab. Your ticks stay in this browser.</p>
      {LIBRARY_GROUPS.map((g) => (
        <Panel key={g.id}>
          <h2 className="mb-2 text-lg font-extrabold">{g.title}</h2>
          <ul className="space-y-2">
            {entriesOf(g.id).map((e) => {
              const on = ticks?.includes(e.id) ?? false;
              return (
                <li key={e.id} className="flex items-start gap-2 rounded-xl bg-ink-800/70 py-1 pl-1 pr-3">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`${e.title}, done`}
                    disabled={ticks === undefined}
                    onClick={() => void toggleLibrary(e.id)}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 font-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${on ? 'border-good-500 bg-good-500 text-ink-950' : 'border-ink-600 text-transparent'}`}
                  >
                    ✓
                  </button>
                  <div className="min-w-0 flex-1 py-2">
                    <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex break-words font-semibold text-ember-400 underline-offset-2 hover:underline max-lg:min-h-11 max-lg:items-center">
                      {e.title}
                    </a>
                    <p className="text-sm text-ink-400">{e.note}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
