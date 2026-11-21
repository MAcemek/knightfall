import { useId, useMemo, useState } from 'react';
import type { PointerEvent } from 'react';
import { accuracyGeometry, type AccuracyPoint } from './insightsLogic.ts';

const W = 640;
const H = 220;
const PAD = 30;

/** Accuracy of the user's side per game, oldest to newest. Same look as the rating chart on the Stats page. */
export function AccuracyChart({ points }: { points: AccuracyPoint[] }) {
  const g = useMemo(() => accuracyGeometry(points.map((p) => p.accuracy), W, H, PAD), [points]);
  const gradId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < g.xy.length; i++) if (Math.abs(g.xy[i].x - x) < Math.abs(g.xy[best].x - x)) best = i;
    setHover(best);
  };

  const last = g.xy[g.xy.length - 1];
  const hp = hover !== null ? g.xy[hover] : null;
  const labelY = [PAD, H / 2, H - PAD];
  const labelV = [g.max, Math.round((g.max + g.min) / 2), g.min];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full touch-pan-y select-none"
      role="img"
      aria-label={`Accuracy from ${Math.round(points[0].accuracy)}% to ${Math.round(points[points.length - 1].accuracy)}% over ${points.length} games`}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-ember-500)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--color-ember-500)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {labelY.map((y, i) => (
        <g key={i}>
          <line x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="var(--color-ink-700)" strokeDasharray="3 5" />
          <text x={4} y={y + 4} fontSize="11" fill="var(--color-ink-400)" fontFamily="var(--font-mono)">{labelV[i]}</text>
        </g>
      ))}
      <path d={g.area} fill={`url(#${gradId})`} className="animate-fade-in" />
      <path
        d={g.line}
        fill="none"
        stroke="var(--color-ember-400)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        className="animate-draw"
      />
      {g.xy.length <= 40 && g.xy.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--color-ember-400)" />)}
      <circle cx={last.x} cy={last.y} r="4.5" fill="var(--color-ember-400)" stroke="var(--color-ink-900)" strokeWidth="2" />
      {hover !== null && hp && (
        <g>
          <line x1={hp.x} x2={hp.x} y1={PAD} y2={H - PAD} stroke="var(--color-ink-500)" />
          <circle cx={hp.x} cy={hp.y} r="4" fill="var(--color-ink-100)" />
          <text textAnchor={hp.x > W / 2 ? 'end' : 'start'} x={hp.x + (hp.x > W / 2 ? -8 : 8)} y={PAD - 8} fontSize="12" fontWeight="700" fill="var(--color-ink-100)">
            {points[hover].accuracy.toFixed(1)}% as {points[hover].side === 'w' ? 'White' : 'Black'} · {new Date(points[hover].at).toLocaleDateString()}
          </text>
        </g>
      )}
    </svg>
  );
}
