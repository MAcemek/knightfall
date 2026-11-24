import type { BlunderStat, ClockStat, RatingDelta, RatingPoint } from './progressLogic.ts';

/** Wording for the Progress tiles. Every tile says what is missing when it has no number. No React. */

export interface TileText {
  value: string;
  sub: string;
}

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function ratingTile(series: readonly RatingPoint[], delta: RatingDelta | null): TileText {
  const last = series[series.length - 1];
  if (!last) return { value: 'None yet', sub: 'Ratings come from Sync on the Today page, which needs your chess.com username.' };
  if (!delta) return { value: String(last.rating), sub: 'Add a starting rating and a target in Plan settings to see the line.' };
  const gap = Math.round(delta.delta);
  const where = gap === 0 ? 'On the line' : `${Math.abs(gap)} ${gap > 0 ? 'above' : 'below'} the line`;
  return { value: String(last.rating), sub: `${where} (${Math.round(delta.target)})` };
}

export function blunderTile(s: BlunderStat): TileText {
  if (s.last === null) return { value: 'None yet', sub: 'Review rapid games in Game Review. Blunders are counted per game for your side.' };
  const base = `Newest ${s.games.last} analysed rapid ${s.games.last === 1 ? 'game' : 'games'}`;
  if (s.previous === null || s.goal === null) return { value: one(s.last), sub: `${base}. Three more games before that give you a goal.` };
  return { value: one(s.last), sub: `${base}. The ${s.games.previous} before: ${one(s.previous)}. Goal: ${one(s.goal)}.` };
}

export function clockTile(s: ClockStat): TileText {
  if (s.share === null) return { value: 'None yet', sub: 'Needs rapid games with clock times, from Sync or a Lichess import.' };
  const goal = 'Goal: use 60 to 70% of your time.';
  return { value: `${Math.round(s.share * 100)}%`, sub: `${s.state === 'low' ? 'Low. You may be playing too fast. ' : ''}${goal}` };
}

/** "42 s" or "1 min 5 s". */
export function secondsText(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'none';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
