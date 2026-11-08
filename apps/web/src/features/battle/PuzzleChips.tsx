import type { PlayedPuzzle } from './battleState.ts';

/** Compact ✓/✗ chips for the puzzles played in a battle (newest last). */
export function PuzzleChips({ history, links = false }: { history: PlayedPuzzle[]; links?: boolean }) {
  return (
    <ol className="flex flex-wrap gap-1.5">
      {history.map((p, i) => {
        const cls = `inline-flex animate-pop items-center gap-1 rounded-lg px-2 py-1 font-mono text-xs font-bold ring-1 ${
          p.solved ? 'bg-good-500/15 text-good-400 ring-good-500/40' : 'bg-bad-500/15 text-bad-400 ring-bad-500/40'
        }`;
        const body = (
          <>
            <span aria-hidden>{p.solved ? '✓' : '✗'}</span>
            <span className="text-ink-300">{p.rating}</span>
          </>
        );
        const title = `Puzzle ${i + 1} (${p.rating}) — ${p.solved ? 'solved' : 'missed'}`;
        return (
          <li key={`${i}-${p.id}`}>
            {links ? (
              <a className={`${cls} transition hover:brightness-125`} href={`https://lichess.org/training/${p.id}`} target="_blank" rel="noreferrer" title={`${title} · open on Lichess`}>
                {body}
              </a>
            ) : (
              <span className={cls} title={title}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
