import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const BAR_PX = 20;

/**
 * Desktop sidebar: an ember bar at the left edge that slides to the active link. Render it as a child of the
 * (position: relative) nav. The sidebar has a divider between groups, so the bar is placed on the measured link
 * (NavLink marks it aria-current="page") instead of a fixed step. The first placement does not animate; only moves
 * between links do. Hidden on pages no link owns, keeping its last position so it reappears in place.
 */
export function SideNavMarker({ pathname }: { pathname: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [mark, setMark] = useState<{ y: number; shown: boolean } | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    // The bar's own parent, not a ref passed down: a parent's ref is not attached yet when a child's layout
    // effect first runs.
    const nav = ref.current?.parentElement;
    if (!nav) return;
    const place = () => {
      const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
      setMark((m) => (link ? { y: link.offsetTop + (link.offsetHeight - BAR_PX) / 2, shown: true } : m && { ...m, shown: false }));
    };
    place();
    // Late web fonts or a due-count badge can change row heights after the first placement.
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [pathname]);

  // Turn the slide on only after the first placement has painted.
  useEffect(() => {
    if (mark && !animate) setAnimate(true);
  }, [mark, animate]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute left-0 top-0 z-10 w-[3px] rounded-r-full bg-ember-400 shadow-[0_0_8px_rgb(255_154_31/0.6)] ${animate ? 'kf-nav-marker' : ''} ${mark?.shown ? '' : 'opacity-0'}`}
      style={{ height: BAR_PX, transform: `translateY(${mark?.y ?? 0}px)` }}
    />
  );
}
