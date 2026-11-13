import { memo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { accuracyGrade, coachSummary, type GameReport, type MoveClass, type Side, type SideNumbers } from '@knightfall/core';
import { MOVE_CLASS_META, MoveGlyph, REPORT_TABLE_CLASSES } from '../../../shared/analysis/index.ts';
import type { StoredGame } from '../../../shared/db.ts';
import { motionOff } from '../../../shared/settings.ts';
import { Button } from '../../../shared/ui.tsx';
import { CoachBubble } from './CoachBubble.tsx';
import { EvalGraph, type GraphDot } from './parts.tsx';
import type { GraphGeometry } from './reviewLogic.ts';

/** Where the collapsible part of the count table starts. */
const COLLAPSE_FROM = REPORT_TABLE_CLASSES.indexOf('inaccuracy');

const fmt1 = (n: number | null) => (n === null ? '—' : n.toFixed(1));
const fmtRating = (n: number | null) => (n === null ? '—' : String(Math.round(n)));

function Divider() {
  return <div className="h-px w-full bg-ink-700/70" role="separator" />;
}

function SectionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2">
      <span className="text-sm font-semibold text-ink-300">{label}</span>
      {children}
    </div>
  );
}

/** A white-side or black-side value box. */
function SideBox({ side, children, caption }: { side: Side; children: ReactNode; caption?: string }) {
  return (
    <div
      className={`rounded-lg px-2 py-2 text-center ${side === 'w' ? 'bg-ink-100 text-ink-900' : 'border border-ink-600 bg-ink-950 text-ink-100'}`}
      aria-label={side === 'w' ? 'White' : 'Black'}
    >
      <div className="font-mono text-lg font-extrabold leading-none">{children}</div>
      {caption && <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">{caption}</div>}
    </div>
  );
}

function Avatar({ name, side, mine }: { name: string; side: Side; mine: boolean }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <div
      className={`mx-auto flex h-12 w-12 items-center justify-center rounded-lg text-xl font-extrabold ${side === 'w' ? 'bg-ink-200 text-ink-900' : 'bg-ink-700 text-ink-100'} ${mine ? 'ring-2 ring-good-500' : ''}`}
      aria-hidden
    >
      {initial}
    </div>
  );
}

function GradeIcon({ value }: { value: number | null }) {
  const cls = accuracyGrade(value);
  if (!cls) return <span className="text-center text-ink-500" aria-label="Not available">{'—'}</span>;
  return <MoveGlyph cls={cls} size={24} className="mx-auto" title={`${MOVE_CLASS_META[cls].label} (${value === null ? '' : Math.round(value)})`} />;
}

export const SummaryView = memo(function SummaryView(props: {
  report: GameReport;
  game: StoredGame;
  mySide: Side | null;
  geom: GraphGeometry;
  dots: GraphDot[];
  mistakeCount: number;
  practiseBusy: boolean;
  staleEngine: boolean;
  onStart: () => void;
  onSeek: (index: number) => void;
  onPractise: () => void;
  onReanalyse: () => void;
}) {
  const { report, game, mySide, geom, dots, mistakeCount, practiseBusy, staleEngine } = props;
  const [open, setOpen] = useState(true);
  const instant = motionOff();

  const rows = REPORT_TABLE_CLASSES.map((c) => ({ c, w: report.counts.white[c], b: report.counts.black[c] }));
  const sideBySide = (n: SideNumbers) => [n.white, n.black] as const;
  const advanced: { label: string; v: SideNumbers }[] = [
    { label: 'Opening', v: report.advanced.opening },
    { label: 'Tactics', v: report.advanced.tactics },
    { label: 'Strategy', v: report.advanced.strategy },
  ];

  const countRow = (r: { c: MoveClass; w: number; b: number }) => {
    const m = MOVE_CLASS_META[r.c];
    return (
      <div key={r.c} className="grid grid-cols-[1fr_2.5rem_1.5rem_2.5rem] items-center gap-2 py-1 text-sm">
        <span className="font-semibold text-ink-200">{m.label}</span>
        <span className={`text-right font-mono font-bold ${r.w ? m.text : 'text-ink-500'}`}>{r.w}</span>
        <MoveGlyph cls={r.c} size={20} className="mx-auto" title={m.label} />
        <span className={`text-left font-mono font-bold ${r.b ? m.text : 'text-ink-500'}`}>{r.b}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <CoachBubble>{coachSummary(report, { perspective: mySide, result: game.result })}</CoachBubble>

      <EvalGraph geom={geom} count={report.evals.length} current={null} dots={dots} onSeek={props.onSeek} />

      <section className="space-y-3" aria-label="Players and accuracy">
        <SectionRow label="Players">
          <div className="min-w-0 space-y-1.5 text-center">
            <div className="truncate text-xs font-semibold text-ink-300">{game.white.name}</div>
            <Avatar name={game.white.name} side="w" mine={mySide === 'w'} />
          </div>
          <div className="min-w-0 space-y-1.5 text-center">
            <div className="truncate text-xs font-semibold text-ink-300">{game.black.name}</div>
            <Avatar name={game.black.name} side="b" mine={mySide === 'b'} />
          </div>
        </SectionRow>
        <SectionRow label="Accuracy">
          <SideBox side="w">{fmt1(report.accuracy.white)}</SideBox>
          <SideBox side="b">{fmt1(report.accuracy.black)}</SideBox>
        </SectionRow>
      </section>

      <Divider />

      <section aria-label="Move counts">
        {rows.slice(0, COLLAPSE_FROM).map(countRow)}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Hide mistake counts' : 'Show mistake counts'}
          className="my-0.5 flex w-full items-center justify-center rounded-md py-0.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-ember-400"
        >
          <svg viewBox="0 0 24 24" className={`h-5 w-5 transition-transform ${open ? '' : '-rotate-90'}`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {open && (
          <motion.div initial={instant ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
            {rows.slice(COLLAPSE_FROM).map(countRow)}
          </motion.div>
        )}
      </section>

      <Divider />

      <SectionRow label="Game Rating">
        <SideBox side="w" caption="est.">{fmtRating(report.estimatedRating.white)}</SideBox>
        <SideBox side="b" caption="est.">{fmtRating(report.estimatedRating.black)}</SideBox>
      </SectionRow>

      <section aria-label="Advanced stats" className="space-y-2">
        <h3 className="text-sm font-extrabold text-ink-100">Advanced Stats</h3>
        {advanced.map((a) => {
          const [w, b] = sideBySide(a.v);
          return (
            <div key={a.label} className="grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2">
              <span className="text-sm font-semibold text-ink-300">{a.label}</span>
              <GradeIcon value={w} />
              <GradeIcon value={b} />
            </div>
          );
        })}
      </section>

      <div className="space-y-2 pt-1">
        <Button variant="good" size="lg" className="w-full text-lg" onClick={props.onStart}>
          Start Review
        </Button>
        <Button variant="secondary" className="w-full" disabled={mistakeCount === 0 || practiseBusy} onClick={props.onPractise}>
          Practise {mistakeCount} mistake{mistakeCount === 1 ? '' : 's'}
        </Button>
        <Link to="/train/review" className="block text-center text-xs font-semibold text-ink-400 underline hover:text-ink-200">
          Open Review mistakes
        </Link>
      </div>

      {staleEngine && (
        <p className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-ink-400">
          Analysed with an older engine {'·'}
          <button type="button" onClick={props.onReanalyse} className="font-bold text-ember-400 underline hover:text-ember-300">
            Re-analyse
          </button>
        </p>
      )}
    </div>
  );
});
