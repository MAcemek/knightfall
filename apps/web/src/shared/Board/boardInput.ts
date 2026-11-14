/** Pure input decisions for the board (no React, no DOM) so they can be unit-tested. */

/** How far (in squares) the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD_MOUSE = 0.12;
/** Fingers jitter: a tap that wobbles a few pixels must stay a tap. */
const DRAG_THRESHOLD_TOUCH = 0.3;

export function dragThreshold(pointerType: string): number {
  return pointerType === 'touch' ? DRAG_THRESHOLD_TOUCH : DRAG_THRESHOLD_MOUSE;
}

/**
 * True when the secondary (right) mouse button is down. Pressing it while the primary button is already
 * held does NOT fire pointerdown (chorded buttons); it only shows up as `buttons & 2` on pointermove.
 */
export function rightButtonHeld(buttons: number): boolean {
  return (buttons & 2) !== 0;
}

export type PointerDownAction =
  | 'ignore'
  /** Right button while dragging: put the piece back, no arrow. */
  | 'cancel-drag'
  /** Right button: draw an arrow / mark a square (and cancel a queued premove). */
  | 'annotate'
  /** The click was consumed by the host (editor painting). */
  | 'consume'
  /** A piece is selected and this square is one of its targets. */
  | 'move-selected'
  /** Pick up one of the user's own pieces. */
  | 'grab'
  /** Free mode: move the selected piece to this square without legality. */
  | 'free-move'
  /** Click on nothing useful: clear selection (and a queued premove). */
  | 'deselect';

export function decidePointerDown(i: {
  button: number;
  promoOpen: boolean;
  dragActive: boolean;
  /** onSquareClick already consumed this press. */
  consumed: boolean;
  selected: string | null;
  sq: string;
  isMine: boolean;
  /** `sq` is a legal / premove target of `selected`. */
  isTargetOfSelected: boolean;
  freeMove: boolean;
}): PointerDownAction {
  if (i.button === 2 && i.dragActive) return 'cancel-drag';
  if (i.promoOpen) return 'ignore';
  if (i.button === 2) return 'annotate';
  if (i.button !== 0) return 'ignore';
  if (i.consumed) return 'consume';
  if (i.selected && i.selected !== i.sq && i.isTargetOfSelected) return 'move-selected';
  if (i.isMine) return 'grab';
  if (i.selected && i.freeMove) return 'free-move';
  return 'deselect';
}

/**
 * Selection after the position changed. The opponent's reply (or a premove landing) must not silently
 * drop a selection the user just made: it is kept while that square still holds one of their pieces.
 */
export function selectionAfterPositionChange(i: {
  selected: string | null;
  /** The whole position was replaced (new puzzle). */
  keyChanged: boolean;
  freeMove: boolean;
  /** Colour of the piece now standing on `selected`, if any. */
  colorAtSelected: 'w' | 'b' | null;
  movableColor: 'w' | 'b';
}): string | null {
  if (!i.selected || i.keyChanged || i.freeMove) return null;
  return i.colorAtSelected === i.movableColor ? i.selected : null;
}
