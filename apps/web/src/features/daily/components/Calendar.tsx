import { Icons } from '../../../shared/ui.tsx';
import { addMonths, dayKind, dayLabel, MIN_MONTH, monthGrid, monthLabel, monthOf, type DailyEntry, type DayKind } from '../dailyLogic.ts';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const CELL: Record<DayKind, string> = {
  clean: 'bg-good-500 text-ink-950 font-black hover:bg-good-400',
  solved: 'bg-good-500/25 text-good-400 ring-1 ring-inset ring-good-500/50 hover:bg-good-500/35',
  late: 'bg-sky-400/15 text-sky-400 ring-1 ring-inset ring-sky-400/40 hover:bg-sky-400/25',
  failed: 'bg-bad-500/20 text-bad-400 hover:bg-bad-500/30',
  missed: 'bg-bad-500/[0.07] text-bad-400/60 hover:bg-bad-500/15',
  open: 'bg-ink-800 text-ink-300 hover:bg-ink-700',
  pending: 'bg-ember-500/10 text-ember-300 hover:bg-ember-500/20',
  future: 'text-ink-600 cursor-not-allowed',
};

const GLYPH: Partial<Record<DayKind, string>> = { clean: '✓', solved: '✓', late: '✓', failed: '✗' };

const TITLE: Record<DayKind, string> = {
  clean: 'Solved first try',
  solved: 'Solved',
  late: 'Played late (not counted for the streak)',
  failed: 'Missed — tap to try again',
  missed: 'Missed — tap to play late',
  open: 'Tap to play',
  pending: 'Today — not solved yet',
  future: 'Not available yet',
};

export interface CalendarProps {
  month: string;
  today: string;
  selected: string;
  records: Map<string, DailyEntry>;
  firstPlayed: string | null;
  onMonth: (month: string) => void;
  onSelect: (date: string) => void;
}

/** Month calendar of daily results: ✓ solved, dim red missed, ember ring for today, future disabled. */
export function Calendar({ month, today, selected, records, firstPlayed, onMonth, onSelect }: CalendarProps) {
  const cells = monthGrid(month);
  const canPrev = month > MIN_MONTH;
  const canNext = month < monthOf(today);
  let solvedCount = 0;
  let pastDays = 0;
  for (const d of cells) {
    if (!d || d > today) continue;
    pastDays++;
    if (records.get(d)?.solved) solvedCount++;
  }

  return (
    <div className="rounded-2xl border border-ink-700/60 bg-ink-850 p-4 shadow-xl shadow-black/20">
      <div className="mb-3 flex items-center justify-between">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition hover:bg-ink-700 hover:text-ink-100 disabled:opacity-30"
          onClick={() => onMonth(addMonths(month, -1))}
          disabled={!canPrev}
          aria-label="Previous month"
        >
          <span className="inline-block rotate-180">{Icons.next('h-4 w-4')}</span>
        </button>
        <div className="text-center">
          <div className="font-bold">{monthLabel(month)}</div>
          <div className="font-mono text-[11px] text-ink-400">
            <span className="text-good-400">{solvedCount}</span>/{pastDays} solved
          </div>
        </div>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition hover:bg-ink-700 hover:text-ink-100 disabled:opacity-30"
          onClick={() => onMonth(addMonths(month, 1))}
          disabled={!canNext}
          aria-label="Next month"
        >
          {Icons.next('h-4 w-4')}
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="pb-1 text-[11px] font-semibold text-ink-500">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const kind = dayKind(d, today, records.get(d), firstPlayed);
          const isToday = d === today;
          const isSel = d === selected;
          return (
            <button
              key={d}
              disabled={kind === 'future'}
              onClick={() => onSelect(d)}
              title={`${dayLabel(d)} · ${TITLE[kind]}`}
              aria-label={`${dayLabel(d)}: ${TITLE[kind]}`}
              aria-current={isSel ? 'date' : undefined}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm font-semibold transition ${CELL[kind]} ${isSel ? 'scale-105 shadow-[0_0_0_2px_var(--color-ink-100)]' : ''}`}
            >
              {isToday && <span className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-inset ring-ember-400" />}
              <span className="leading-none">{Number(d.slice(8))}</span>
              {GLYPH[kind] && <span className="mt-0.5 text-[10px] leading-none">{GLYPH[kind]}</span>}
              {isToday && kind === 'pending' && <span className="absolute bottom-1 h-1 w-1 animate-pulse rounded-full bg-ember-400" />}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
        <Legend className="bg-good-500" label="Solved" />
        <Legend className="bg-sky-400/60" label="Played late" />
        <Legend className="bg-bad-500/40" label="Missed" />
        <Legend className="ring-2 ring-ember-400" label="Today" />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}
