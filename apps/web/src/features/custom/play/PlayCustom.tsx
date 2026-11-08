import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db, type CustomPuzzle } from '../../../shared/db.ts';
import { FloatingDelta, TickerNumber } from '../../../shared/fx/index.ts';
import { Button, Icons, PageHeader, Panel } from '../../../shared/ui.tsx';
import { useShare } from '../share.tsx';
import { draftOf, recordPlay } from '../store.ts';
import { CustomPlayer } from './CustomPlayer.tsx';

/** /custom/play/:id — play one of your saved puzzles. */
export function PlayCustom() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { share, modal } = useShare();
  // Loaded once per id so live stat updates don't restart the runner.
  const [puzzle, setPuzzle] = useState<CustomPuzzle | null | undefined>(undefined);
  const [solveBump, setSolveBump] = useState(0);

  useEffect(() => {
    // Keep showing the previous puzzle until the next one is loaded (no flash between puzzles).
    let alive = true;
    void db.customPuzzles.get(id).then((p) => alive && setPuzzle(p ?? null));
    return () => {
      alive = false;
    };
  }, [id]);

  const live = useLiveQuery(() => db.customPuzzles.get(id), [id]);
  const order = useLiveQuery(() => db.customPuzzles.orderBy('updatedAt').reverse().primaryKeys(), []);
  const idx = order?.indexOf(id) ?? -1;
  const nextId = order && order.length > 1 && idx >= 0 ? order[(idx + 1) % order.length] : null;

  const header = (
    <PageHeader
      title="Custom puzzle"
      icon={Icons.pencil('h-6 w-6')}
      right={
        <Link to="/custom" className="text-sm font-semibold text-ink-400 transition hover:text-ink-100">
          ← My puzzles
        </Link>
      }
    />
  );

  if (puzzle === undefined) return <>{header}<div className="p-10 text-center text-ink-400">Loading puzzle…</div></>;
  if (puzzle === null) {
    return (
      <>
        {header}
        <Panel className="mx-auto max-w-md space-y-4 text-center">
          <p className="text-lg font-bold">Puzzle not found</p>
          <p className="text-sm text-ink-400">It may have been deleted from this device.</p>
          <Button variant="primary" onClick={() => navigate('/custom')}>
            Back to my puzzles
          </Button>
        </Panel>
      </>
    );
  }

  const plays = live?.plays ?? puzzle.plays ?? 0;
  const solves = live?.solves ?? puzzle.solves ?? 0;
  const rate = plays ? Math.round((solves / plays) * 100) : 0;

  return (
    <>
      {header}
      <CustomPlayer
        puzzle={puzzle}
        onNext={nextId ? () => navigate(`/custom/play/${nextId}`) : undefined}
        onResult={(r) => {
          if (r.solved) setSolveBump((b) => b + 1);
          void recordPlay(puzzle, r);
        }}
        actions={
          <>
            <Button size="sm" onClick={() => navigate(`/custom/edit/${puzzle.id}`)}>
              {Icons.pencil('h-4 w-4')} Edit
            </Button>
            <Button size="sm" onClick={() => share(draftOf(live ?? puzzle))}>
              {Icons.share('h-4 w-4')} Share
            </Button>
          </>
        }
        stats={
          <Panel className="grid grid-cols-3 gap-2 p-3">
            <MiniStat label="Plays" value={plays} />
            <div className="relative">
              <MiniStat label="Solves" value={solves} accent="text-good-400" />
              <FloatingDelta delta={1} trigger={solveBump || null} />
            </div>
            <MiniStat label="Rate" value={rate} suffix="%" />
          </Panel>
        }
      />
      {modal}
    </>
  );
}

function MiniStat({ label, value, suffix = '', accent = 'text-ink-100' }: { label: string; value: number; suffix?: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-ink-800/70 px-3 py-2 text-center">
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`font-mono text-xl font-bold ${accent}`}>
        <TickerNumber value={value} />
        {suffix}
      </div>
    </div>
  );
}
