import { describe, expect, it } from 'vitest';
import { decidePointerDown, dragThreshold, rightButtonHeld, selectionAfterPositionChange } from './boardInput.ts';

const base = {
  button: 0,
  promoOpen: false,
  dragActive: false,
  consumed: false,
  selected: null as string | null,
  sq: 'e2',
  isMine: false,
  isTargetOfSelected: false,
  freeMove: false,
};

describe('rightButtonHeld', () => {
  it('detects the chorded right button on pointermove', () => {
    expect(rightButtonHeld(1)).toBe(false);
    expect(rightButtonHeld(3)).toBe(true);
    expect(rightButtonHeld(2)).toBe(true);
    expect(rightButtonHeld(0)).toBe(false);
  });
});

describe('dragThreshold', () => {
  it('is larger for touch so a wobbly tap stays a tap', () => {
    expect(dragThreshold('touch')).toBeGreaterThan(dragThreshold('mouse'));
    expect(dragThreshold('pen')).toBe(dragThreshold('mouse'));
  });
});

describe('decidePointerDown', () => {
  it('right button cancels an active drag instead of starting an arrow', () => {
    expect(decidePointerDown({ ...base, button: 2, dragActive: true })).toBe('cancel-drag');
  });
  it('right button with no drag annotates', () => {
    expect(decidePointerDown({ ...base, button: 2 })).toBe('annotate');
  });
  it('ignores presses while the promotion picker is open', () => {
    expect(decidePointerDown({ ...base, promoOpen: true, isMine: true })).toBe('ignore');
  });
  it('ignores middle/other buttons', () => {
    expect(decidePointerDown({ ...base, button: 1 })).toBe('ignore');
  });
  it('lets the host consume a click', () => {
    expect(decidePointerDown({ ...base, consumed: true, isMine: true })).toBe('consume');
  });
  it('moves the selected piece when a target is clicked', () => {
    expect(decidePointerDown({ ...base, selected: 'e2', sq: 'e4', isTargetOfSelected: true })).toBe('move-selected');
  });
  it('re-selecting another own piece grabs it, even if the square is a target-less one', () => {
    expect(decidePointerDown({ ...base, selected: 'e2', sq: 'd2', isMine: true })).toBe('grab');
  });
  it('clicking the selected piece again grabs (never deselects, so a double tap cannot lose it)', () => {
    expect(decidePointerDown({ ...base, selected: 'e2', sq: 'e2', isMine: true })).toBe('grab');
  });
  it('capturing onto an own-looking target prefers the move (premove onto a friendly piece)', () => {
    expect(decidePointerDown({ ...base, selected: 'e2', sq: 'd2', isMine: true, isTargetOfSelected: true })).toBe('move-selected');
  });
  it('free mode moves anywhere', () => {
    expect(decidePointerDown({ ...base, selected: 'e2', sq: 'a8', freeMove: true })).toBe('free-move');
  });
  it('clicking nothing deselects', () => {
    expect(decidePointerDown({ ...base, selected: 'e2', sq: 'a8' })).toBe('deselect');
    expect(decidePointerDown({ ...base })).toBe('deselect');
  });
});

describe('selectionAfterPositionChange', () => {
  const k = { keyChanged: false, freeMove: false, movableColor: 'b' as const };
  it('keeps a selection the user made during the opponent reply', () => {
    expect(selectionAfterPositionChange({ ...k, selected: 'g8', colorAtSelected: 'b' })).toBe('g8');
  });
  it('drops it when the piece is gone or captured', () => {
    expect(selectionAfterPositionChange({ ...k, selected: 'g8', colorAtSelected: null })).toBeNull();
    expect(selectionAfterPositionChange({ ...k, selected: 'g8', colorAtSelected: 'w' })).toBeNull();
  });
  it('drops it for a new puzzle and in free mode', () => {
    expect(selectionAfterPositionChange({ ...k, keyChanged: true, selected: 'g8', colorAtSelected: 'b' })).toBeNull();
    expect(selectionAfterPositionChange({ ...k, freeMove: true, selected: 'g8', colorAtSelected: 'b' })).toBeNull();
  });
  it('stays null when nothing was selected', () => {
    expect(selectionAfterPositionChange({ ...k, selected: null, colorAtSelected: 'b' })).toBeNull();
  });
});
