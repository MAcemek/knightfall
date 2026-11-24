import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { buildChart, nearestDot, pathOf, shortDate } from './chartLogic.ts';
import type { RatingPoint, TargetLine } from './progressLogic.ts';

/** Rating over time with the target line. Drawn at the real pixel width so the labels stay readable on a phone. */

const HEIGHT = 240;
const PAD = { left: 44, right: 12, top: 12, bottom: 28 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.max(240, Math.floor(el.clientWidth)));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export function RatingChart({ ratings, line, label }: { ratings: readonly RatingPoint[]; line: TargetLine | null; label: string }) {
  const { ref, width } = useWidth();
  const [picked, setPicked] = useState<number | null>(null);
  const m = buildChart(ratings, line, { width, height: HEIGHT, pad: PAD });
  const active = picked !== null && picked < m.dots.length ? picked : m.dots.length - 1;
  const dot = m.dots[active];

  const point = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setPicked(nearestDot(m.dots, e.clientX - box.left));
  };

  const gap = dot && dot.target !== null ? dot.value - dot.target : null;
  const readout = dot
    ? `${shortDate(dot.date)}: ${dot.value}${dot.target !== null ? `. Target line ${dot.target}${gap === 0 ? ', on it' : gap !== null ? `, ${Math.abs(gap)} ${gap > 0 ? 'above' : 'below'}` : ''}` : ''}`
    : '';

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-300">
        <span className="inline-flex items-center gap-2">
          <svg width="22" height="8" aria-hidden>
            <line x1="0" y1="4" x2="22" y2="4" className="stroke-ember-400" strokeWidth="2" />
            <circle cx="11" cy="4" r="3.5" className="fill-ember-400" />
          </svg>
          {label} rating
        </span>
        {m.line.length > 0 && (
          <span className="inline-flex items-center gap-2">
            <svg width="22" height="8" aria-hidden>
              <line x1="0" y1="4" x2="22" y2="4" className="stroke-ink-300" strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            Target line
          </span>
        )}
      </div>
      <div ref={ref} className="w-full min-w-0 overflow-hidden">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${label} rating over time${m.line.length ? ' with the target line' : ''}. ${ratings.length} ${ratings.length === 1 ? 'point' : 'points'}.`}
          className="block touch-pan-y select-none"
          onPointerMove={point}
          onPointerDown={point}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setPicked(null);
          }}
        >
          {m.yTicks.map((t) => (
            <g key={t.label}>
              <line x1={m.plot.left} x2={m.plot.right} y1={t.pos} y2={t.pos} className="stroke-ink-700" strokeWidth="1" />
              <text x={m.plot.left - 6} y={t.pos + 4} textAnchor="end" className="fill-ink-400 text-[11px]">
                {t.label}
              </text>
            </g>
          ))}
          {m.xTicks.map((t, i) => (
            <text key={t.label} x={t.pos} y={HEIGHT - 8} textAnchor={i === 0 ? 'start' : i === m.xTicks.length - 1 ? 'end' : 'middle'} className="fill-ink-400 text-[11px]">
              {t.label}
            </text>
          ))}
          {m.line.length > 1 && <path d={pathOf(m.line)} fill="none" className="stroke-ink-300" strokeWidth="2" strokeDasharray="5 4" />}
          {m.dots.length > 1 && <path d={pathOf(m.dots)} fill="none" className="stroke-ember-400" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          {dot && (
            <>
              <line x1={dot.x} x2={dot.x} y1={m.plot.top} y2={m.plot.bottom} className="stroke-ink-500" strokeWidth="1" />
              {m.dots.length <= 40 && m.dots.map((d) => <circle key={d.date} cx={d.x} cy={d.y} r="3.5" className="fill-ember-400 stroke-ink-850" strokeWidth="2" />)}
              <circle cx={dot.x} cy={dot.y} r="5.5" className="fill-ember-400 stroke-ink-850" strokeWidth="2" />
            </>
          )}
        </svg>
      </div>
      <p className="mt-2 min-h-6 font-mono text-sm font-bold text-ink-100" aria-live="polite">
        {readout}
      </p>
      <details className="mt-2 text-sm text-ink-300">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-ink-300">Show as a table</summary>
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-left">
            <thead className="text-xs uppercase tracking-wider text-ink-400">
              <tr>
                <th className="py-1 pr-3 font-semibold">Date</th>
                <th className="py-1 pr-3 font-semibold">Rating</th>
                <th className="py-1 font-semibold">Target line</th>
              </tr>
            </thead>
            <tbody>
              {[...m.dots].reverse().map((d) => (
                <tr key={d.date} className="border-t border-ink-800">
                  <td className="py-1 pr-3">{d.date}</td>
                  <td className="py-1 pr-3 font-mono">{d.value}</td>
                  <td className="py-1 font-mono">{d.target ?? 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
