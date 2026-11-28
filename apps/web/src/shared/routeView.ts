/**
 * Which "view" a path shows, for the page entrance animation and the phone nav indicator.
 * Pure, so App.tsx stays thin and the rules are tested.
 */

/** Sections whose second path segment is a parameter (a date, a game), except for the listed literal pages. */
const PARAM_SECOND: Record<string, readonly string[]> = {
  daily: [],
  analysis: ['insights'],
};

/**
 * A key that changes when the page shows a different view, so the entrance animation replays, and stays the same
 * when only a parameter changes inside one view (another date on the Daily calendar, another game in a review,
 * the next drill), so a live board never fades out under the player.
 *
 *   /train → /train/woodpecker      new view
 *   /rush → /rush/play/3min         new view
 *   /daily → /daily/2026-11-20      same view (Daily keeps the board; the calendar picks the date)
 *   /analysis/a → /analysis/b       same view
 */
export function viewKey(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  const [section, second] = segs;
  if (section === undefined) return 'home';
  if (second === undefined) return section;
  const literals = PARAM_SECOND[section];
  if (literals) return literals.includes(second) ? `${section}/${second}` : section;
  return `${section}/${second}/${segs.length}`;
}

/** Index of the nav item that owns `pathname`, or -1 when none does (Coach, Stats and Settings live elsewhere). */
export function navIndex(pathname: string, items: readonly { to: string; end?: boolean }[]): number {
  return items.findIndex(({ to, end }) => pathname === to || (!end && pathname.startsWith(to.endsWith('/') ? to : `${to}/`)));
}

/** Pages the phone bar's "More" tab stands for. */
const MORE_SECTIONS = ['/daily', '/rush', '/custom', '/analysis'] as const;

/** Phone bar tabs in order; "More" has no route of its own. */
export const PHONE_TAB_PATHS = ['/', '/puzzles', '/train', '/battle'] as const;
export const PHONE_MORE_INDEX = 4;

/**
 * Index of the phone bottom-bar tab that owns `pathname` (0 Home, 1 Puzzles, 2 Train, 3 Battle, 4 More),
 * or -1 for pages with no tab (Coach, Stats, Settings, Play: they live in the top bar).
 */
export function phoneTabIndex(pathname: string): number {
  const own = navIndex(pathname, PHONE_TAB_PATHS.map((to) => ({ to, end: to === '/' })));
  if (own >= 0) return own;
  return MORE_SECTIONS.some((to) => pathname === to || pathname.startsWith(`${to}/`)) ? PHONE_MORE_INDEX : -1;
}
