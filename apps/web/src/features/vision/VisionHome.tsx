import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sfx } from '../../shared/fx/index.ts';
import { Icons, PageHeader, Segmented } from '../../shared/ui.tsx';
import { useVisionBests } from './bestStore.ts';
import { bestKey, DRILL_ORDER, DRILLS, parseColor, type VisionColor, type VisionDrill } from './visionLogic.ts';

const COLOR_KEY = 'kf:vision:color';
const SIDES = [
  { id: 'w', label: 'As White' },
  { id: 'b', label: 'As Black' },
] as const;

function readColor(): VisionColor {
  try {
    return parseColor(localStorage.getItem(COLOR_KEY));
  } catch {
    return 'w';
  }
}

const KnightIcon = (c = 'h-6 w-6') => <img src="/pieces/wN.svg" alt="" className={`${c} -scale-x-100`} />;

const DRILL_ICON: Record<VisionDrill, (c?: string) => ReactNode> = {
  find: Icons.target,
  name: Icons.eye,
  knight: KnightIcon,
};

/** /train/vision: pick a drill and the side the board is seen from. */
export function VisionHome() {
  const navigate = useNavigate();
  const bests = useVisionBests();
  const [color, setColor] = useState<VisionColor>(readColor);

  const changeColor = (c: VisionColor) => {
    setColor(c);
    try {
      localStorage.setItem(COLOR_KEY, c);
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Board vision"
        subtitle="Quick drills to know every square without looking for the labels"
        icon={Icons.eye('h-6 w-6')}
        right={
          <Link to="/train" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition hover:text-ink-100">
            ← Train
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink-300">Board seen from</span>
        <Segmented label="Board seen from" options={SIDES} value={color} onChange={changeColor} />
      </div>

      <div className="grid gap-3">
        {DRILL_ORDER.map((d, i) => {
          const best = bests?.[bestKey(d, color)];
          return (
            <button
              key={d}
              type="button"
              style={{ animationDelay: `${i * 40}ms` }}
              onClick={() => {
                sfx.click();
                navigate(`/train/vision/${d}?c=${color}`);
              }}
              className="group flex w-full animate-rise items-center gap-3 rounded-2xl border border-ink-700/60 bg-ink-850 p-4 text-left shadow-xl shadow-black/20 transition-colors hover:border-ink-500 hover:bg-ink-800/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-ember-400">{DRILL_ICON[d]('h-6 w-6')}</div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-extrabold leading-tight">{DRILLS[d].title}</h2>
                <p className="text-sm text-ink-400">{DRILLS[d].blurb}</p>
                <p className="mt-0.5 text-xs text-ink-500">{DRILLS[d].durationMs / 1000} seconds</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Best</div>
                <div className={`font-mono text-2xl font-black tabular ${best ? 'text-ember-400' : 'text-ink-600'}`}>{best ?? '–'}</div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-ink-500">
        Practise from both sides: Black's view flips every square, and it is the one most players never train. Nothing here changes
        your rating.
      </p>
    </div>
  );
}
