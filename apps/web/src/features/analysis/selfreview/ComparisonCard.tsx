import type { SelfReview } from '../../../shared/db.ts';
import { Button } from '../../../shared/ui.tsx';
import { reasonLabel, type SelfReviewResult } from './selfReviewLogic.ts';

/** What the card knows about the engine: still running, finished (result given), or not running at all. */
export type EngineState = 'waiting' | 'ready' | 'none';

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-ink-900 px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-0.5 truncate font-mono text-base font-bold text-ink-100">{value}</div>
    </div>
  );
}

/** Your own point of no return against the engine's, with the reason and the lesson you wrote. Shown above the summary. */
export function ComparisonCard({ row, result, engine, mineLabel, canRetry, onRetry, onShow }: {
  row: SelfReview;
  result: SelfReviewResult | null;
  engine: EngineState;
  /** Label of your own move, from the stored game (known before the engine finishes). */
  mineLabel: string | null;
  canRetry: boolean;
  onRetry: (ply: number) => void;
  onShow: (ply: number) => void;
}) {
  const enginePly = result?.enginePly ?? null;
  const reason = reasonLabel(row.reason);
  return (
    <section className="space-y-3 rounded-xl bg-ink-800/70 p-3" aria-label="Your review against the engine">
      <h2 className="text-base font-extrabold">Your review</h2>
      <div className="grid grid-cols-2 gap-2">
        <Cell label="Your point" value={mineLabel ?? 'None'} />
        <Cell label="Engine's point" value={engine === 'ready' ? (result?.engineLabel ?? 'None') : '–'} />
      </div>
      {engine === 'ready' && result && <p className="text-sm text-ink-200">{result.text}</p>}
      {engine === 'waiting' && (
        <p className="text-sm text-ink-400" role="status">
          Waiting for the engine
        </p>
      )}
      {engine === 'none' && <p className="text-sm text-ink-400">There is no engine result for this game yet.</p>}
      {reason && (
        <p className="text-sm text-ink-300">
          Reason: <span className="font-bold text-ink-100">{reason}</span>
        </p>
      )}
      {row.lesson && (
        <p className="break-words text-sm text-ink-300">
          Your lesson: <span className="font-bold text-ink-100">{row.lesson}</span>
        </p>
      )}
      {engine === 'ready' && enginePly !== null && (
        <div className="flex flex-wrap gap-2">
          {canRetry && (
            <Button size="sm" variant="primary" onClick={() => onRetry(enginePly)}>
              Retry that move
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => onShow(enginePly)}>
            Show it
          </Button>
        </div>
      )}
    </section>
  );
}
