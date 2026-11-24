import { addDays } from '@knightfall/core';
import { daysBetween } from '../../shared/localDate.ts';
import type { RatingPoint, TargetLine } from './progressLogic.ts';

/** Geometry of the rating chart: scales, ticks and the nearest point to a pointer. Pure, no React. */

export interface ChartSize {
  width: number;
  height: number;
  /** Space left of, right of, above and below the plot, for labels. */
  pad: { left: number; right: number; top: number; bottom: number };
}

export interface Tick {
  pos: number;
  label: string;
}

export interface Dot {
  x: number;
  y: number;
  date: string;
  value: number;
  /** Value of the target line on this date, when there is a line. */
  target: number | null;
}

export interface ChartModel {
  dots: Dot[];
  /** Target line corners, in chart coordinates. */
  line: { x: number; y: number }[];
  xTicks: Tick[];
  yTicks: Tick[];
  plot: { left: number; right: number; top: number; bottom: number };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Mar" for a date key. */
export function shortDate(date: string): string {
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return MONTHS[m - 1] ? `${d} ${MONTHS[m - 1]}` : date;
}

/** Round tick values that cover [min, max], about `count` of them. Always at least two. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  // At least 4, so the step is a whole number and labels are never like 1500.5.
  const span = Math.max(hi - lo, 4);
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const first = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = first; v < hi + step - 1e-9 && out.length < 12; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out.length < 2) out.push(first + step);
  return out;
}

/** Scales for the ratings and the target line. Dates go left to right; the value range always includes the line. */
export function buildChart(ratings: readonly RatingPoint[], line: TargetLine | null, size: ChartSize): ChartModel {
  const dates = [...ratings.map((r) => r.date), ...(line?.points.map((p) => p.date) ?? [])].sort();
  const first = dates[0] ?? '2000-01-01';
  const realLast = dates[dates.length - 1] ?? first;
  let last = realLast;
  if (last === first) last = addDays(first, 1);
  const days = Math.max(1, daysBetween(first, last));
  const values = [...ratings.map((r) => r.rating), ...(line?.points.map((p) => p.value) ?? [])];
  const yTicks = niceTicks(values.length ? Math.min(...values) : 0, values.length ? Math.max(...values) : 100, 4);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const plot = { left: size.pad.left, right: size.width - size.pad.right, top: size.pad.top, bottom: size.height - size.pad.bottom };
  const x = (date: string) => plot.left + (daysBetween(first, date) / days) * (plot.right - plot.left);
  const y = (v: number) => plot.bottom - ((v - yMin) / Math.max(1, yMax - yMin)) * (plot.bottom - plot.top);
  const tickCount = 4;
  const xTicks: Tick[] = [];
  for (let i = 0; i < tickCount; i++) {
    const date = addDays(first, Math.round((days * i) / (tickCount - 1)));
    if (date > realLast) continue;
    if (!xTicks.some((t) => t.label === shortDate(date))) xTicks.push({ pos: x(date), label: shortDate(date) });
  }
  return {
    dots: ratings.map((r) => ({ x: x(r.date), y: y(r.rating), date: r.date, value: r.rating, target: line ? Math.round(line.valueAt(r.date)) : null })),
    line: line ? line.points.map((p) => ({ x: x(p.date), y: y(p.value) })) : [],
    xTicks,
    yTicks: yTicks.map((v) => ({ pos: y(v), label: String(v) })),
    plot,
  };
}

/** Index of the dot closest to a pointer position (by x), or -1 without dots. */
export function nearestDot(dots: readonly Pick<Dot, 'x'>[], px: number): number {
  let best = -1;
  let dist = Infinity;
  dots.forEach((d, i) => {
    const e = Math.abs(d.x - px);
    if (e < dist) {
      dist = e;
      best = i;
    }
  });
  return best;
}

/** SVG path through points: "M x y L x y ...". Empty for no points. */
export function pathOf(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}
