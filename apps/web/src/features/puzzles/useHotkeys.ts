import { useEffect, useRef } from 'react';

/**
 * Global keyboard shortcuts. Keys are matched against `event.key.toLowerCase()`
 * ("h", "enter", " ", "arrowleft"...). Typing in inputs is ignored, and modifier combos pass through.
 * A handler returning `false` means "not handled" (the event is left alone).
 */
export function useHotkeys(map: Record<string, () => boolean | void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const fn = ref.current[e.key.toLowerCase()];
      if (!fn) return;
      if (fn() === false) return;
      e.preventDefault();
      // Prevent a focused button from also being activated by Enter/Space.
      if (e.key === 'Enter' || e.key === ' ') (document.activeElement as HTMLElement | null)?.blur?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
