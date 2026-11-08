import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { utcDateKey } from '@knightfall/core';
import { db } from '../../shared/db.ts';
import { TickerNumber } from '../../shared/fx/index.ts';
import { Icons, PageHeader } from '../../shared/ui.tsx';
import { Calendar } from './components/Calendar.tsx';
import { Countdown } from './components/Countdown.tsx';
import { DailyView } from './DailyView.tsx';
import { bestStreakOf, firstPlayedDate, isDateKey, MIN_MONTH, monthOf, streakOf } from './dailyLogic.ts';

/** /daily (today) and /daily/YYYY-MM-DD (a past day, played late). */
export default function DailyPage() {
  return (
    <Routes>
      <Route path=":date?" element={<DailyRoute />} />
      <Route path="*" element={<Navigate to="/daily" replace />} />
    </Routes>
  );
}

function DailyRoute() {
  const { date: param } = useParams();
  const navigate = useNavigate();
  const [today, setToday] = useState(() => utcDateKey(new Date()));
  const rows = useLiveQuery(() => db.daily.toArray(), []);
  const date = param ?? today;
  const [month, setMonth] = useState(() => monthOf(date));
  useEffect(() => setMonth(monthOf(date)), [date]);

  const { records, streak, best, firstPlayed } = useMemo(() => {
    const list = rows ?? [];
    return {
      records: new Map(list.map((r) => [r.date, r])),
      streak: streakOf(list, today),
      best: bestStreakOf(list),
      firstPlayed: firstPlayedDate(list),
    };
  }, [rows, today]);

  if (param !== undefined && (!isDateKey(param) || param >= today || monthOf(param) < MIN_MONTH)) {
    return <Navigate to="/daily" replace />;
  }

  return (
    <>
      <PageHeader
        title="Daily Puzzle"
        subtitle="One puzzle a day · the same for everyone"
        icon={Icons.calendar('h-6 w-6')}
        right={
          <div className="flex items-center gap-2">
            <StreakChip streak={streak} best={best} loaded={rows !== undefined} />
            <Countdown onRollover={setToday} />
          </div>
        }
      />
      <DailyView
        key={date}
        date={date}
        today={today}
        records={records}
        streak={streak}
        best={best}
        calendar={
          <Calendar
            month={month}
            today={today}
            selected={date}
            records={records}
            firstPlayed={firstPlayed}
            onMonth={setMonth}
            onSelect={(d) => navigate(d >= today ? '/daily' : `/daily/${d}`)}
          />
        }
      />
    </>
  );
}

/** 🔥 daily streak that counts up (and pops) when it grows. */
function StreakChip({ streak, best, loaded }: { streak: number; best: number; loaded: boolean }) {
  const prev = useRef<number | null>(null);
  const [popKey, setPopKey] = useState(0);
  useEffect(() => {
    if (!loaded) return;
    if (prev.current !== null && streak > prev.current) setPopKey((k) => k + 1);
    prev.current = streak;
  }, [streak, loaded]);
  const lit = streak > 0;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-ink-850 px-3 py-2 ring-1 ring-ink-700/60" data-daily-streak title={`Best: ${best} days`}>
      <span key={`f${popKey}`} className={`inline-block text-xl ${popKey ? 'animate-pop' : ''} ${lit ? 'drop-shadow-[0_0_10px_rgb(255_154_31/0.6)]' : 'opacity-40 grayscale'}`}>
        🔥
      </span>
      <div className="leading-tight">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Day streak</div>
        <div className={`font-mono text-sm font-bold ${lit ? 'text-ember-400' : 'text-ink-300'}`}>
          {loaded ? <TickerNumber value={streak} duration={0.8} /> : '—'}
          <span className="ml-1.5 text-[11px] font-semibold text-ink-500">best {best}</span>
        </div>
      </div>
    </div>
  );
}
