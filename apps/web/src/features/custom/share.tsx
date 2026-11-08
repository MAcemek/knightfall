import { useState, type ReactNode } from 'react';
import { sfx } from '../../shared/fx/index.ts';
import { Button, Icons, Modal } from '../../shared/ui.tsx';
import { useToast } from './bits.tsx';
import { shareUrl, type PuzzleDraft } from './logic.ts';

/**
 * Share a puzzle as a self-contained link (the whole puzzle lives in the URL hash).
 * Copies to the clipboard with a toast; falls back to a modal with a selectable link.
 */
export function useShare(): { share: (d: PuzzleDraft) => void; modal: ReactNode } {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);

  const share = (d: PuzzleDraft) => {
    const link = shareUrl(window.location.origin, d);
    const fallback = () => setUrl(link);
    if (!navigator.clipboard?.writeText) return fallback();
    navigator.clipboard.writeText(link).then(() => {
      sfx.correct();
      toast('Share link copied to clipboard');
    }, fallback);
  };

  const modal = (
    <Modal open={!!url} onClose={() => setUrl(null)}>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ember-500/15 text-ember-400">{Icons.share('h-5 w-5')}</div>
        <h2 className="text-lg font-extrabold">Share this puzzle</h2>
      </div>
      <p className="mb-3 text-sm text-ink-400">Anyone with this link can play it — no account needed.</p>
      <input
        readOnly
        value={url ?? ''}
        onFocus={(e) => e.currentTarget.select()}
        autoFocus
        className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 font-mono text-xs text-ink-200 outline-none focus:border-ember-500"
      />
      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={() => setUrl(null)}>
          Done
        </Button>
      </div>
    </Modal>
  );

  return { share, modal };
}
