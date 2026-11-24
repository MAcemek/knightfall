import { Button, Icons } from '../../../shared/ui.tsx';
import type { WoodSlotState } from './woodSlotLogic.ts';

/**
 * "Add to next Woodpecker set" under the move list. Always the same height, so nothing below it moves between
 * moves: it is empty (and out of the tab order) when the shown move cannot be picked.
 */
export function WoodSlot({ state, busy, onAdd }: { state: WoodSlotState; busy: boolean; onAdd: () => void }) {
  return (
    <div className="flex h-11 items-center" data-testid="wood-slot">
      {state.kind === 'add' && (
        <Button size="sm" variant="secondary" className="w-full" disabled={busy} onClick={onAdd}>
          {Icons.target('h-4 w-4')} Add to next Woodpecker set
        </Button>
      )}
      {state.kind === 'in-set' && (
        <p className="flex items-center gap-2 px-1 text-sm font-bold text-good-400">
          {Icons.check('h-4 w-4')} In your next set
        </p>
      )}
    </div>
  );
}
