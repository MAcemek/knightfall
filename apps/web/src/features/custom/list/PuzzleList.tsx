import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db, type CustomPuzzle } from '../../../shared/db.ts';
import { burstAt, PALETTES, sfx } from '../../../shared/fx/index.ts';
import { pieceUrl } from '../../../shared/Board/index.ts';
import { Button, Icons, Modal, PageHeader, Panel } from '../../../shared/ui.tsx';
import { useToast } from '../bits.tsx';
import { displayTitle, themeLabel } from '../logic.ts';
import { useShare } from '../share.tsx';
import { deleteCustom, draftOf, exportAll, importFile, type ImportReport } from '../store.ts';
import { PuzzleCard } from './PuzzleCard.tsx';

type SortKey = 'recent' | 'easy' | 'hard';
const PAGE = 24;

/** /custom — grid of the player's own puzzles. */
export function PuzzleList() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { share, modal: shareModal } = useShare();
  const puzzles = useLiveQuery(() => db.customPuzzles.orderBy('updatedAt').reverse().toArray(), []);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [limit, setLimit] = useState(PAGE);
  const [toDelete, setToDelete] = useState<CustomPuzzle | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Captured once: the router state is cleared after the celebration so a refresh doesn't replay it.
  const [highlight, setHighlight] = useState(() => (location.state as { highlight?: string } | null)?.highlight ?? null);
  const celebrated = useRef(false);

  // Celebrate the card that was just saved, then clear the router state so it doesn't replay.
  useEffect(() => {
    if (!highlight || !puzzles || celebrated.current) return;
    const t = setTimeout(() => {
      celebrated.current = true;
      setTimeout(() => setHighlight(null), 2400);
      const el = document.querySelector(`[data-puzzle-id="${highlight}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      burstAt(el, { count: 34, colors: PALETTES.ember, power: 7, size: 5 });
      navigate(location.pathname, { replace: true, state: null });
    }, 220);
    return () => clearTimeout(t);
  }, [highlight, puzzles, navigate, location.pathname]);

  const shown = useMemo(() => {
    if (!puzzles) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? puzzles.filter((p) => displayTitle(p).toLowerCase().includes(q) || p.themes.some((t) => t.toLowerCase().includes(q) || themeLabel(t).toLowerCase().includes(q)))
      : puzzles.slice();
    if (sort === 'easy') list.sort((a, b) => a.rating - b.rating);
    if (sort === 'hard') list.sort((a, b) => b.rating - a.rating);
    return list;
  }, [puzzles, query, sort]);

  const totals = useMemo(() => {
    const plays = puzzles?.reduce((s, p) => s + (p.plays ?? 0), 0) ?? 0;
    const solves = puzzles?.reduce((s, p) => s + (p.solves ?? 0), 0) ?? 0;
    return { plays, solves };
  }, [puzzles]);

  const onExport = async () => {
    const n = await exportAll();
    toast(`Exported ${n} puzzle${n === 1 ? '' : 's'}`);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const r = await importFile(file);
    if (fileInput.current) fileInput.current.value = '';
    if (r.added) {
      sfx.solved();
      toast(`Imported ${r.added} puzzle${r.added === 1 ? '' : 's'}${r.duplicates ? ` · ${r.duplicates} already saved` : ''}`);
    } else if (r.duplicates && !r.errors.length) {
      toast(`All ${r.duplicates} puzzles were already saved`, 'info');
    } else {
      sfx.wrong();
      toast('Nothing imported', 'bad');
    }
    if (r.errors.length) setReport(r);
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const el = document.querySelector(`[data-puzzle-id="${toDelete.id}"]`);
    burstAt(el, { count: 24, colors: PALETTES.bad, power: 5 });
    sfx.capture();
    await deleteCustom(toDelete.id);
    toast('Puzzle deleted', 'info');
    setToDelete(null);
  };

  const hasAny = !!puzzles && puzzles.length > 0;

  return (
    <>
      <PageHeader
        title="Custom Puzzles"
        subtitle={hasAny ? `${puzzles.length} puzzle${puzzles.length === 1 ? '' : 's'} · ${totals.solves}/${totals.plays} solved` : 'Create, play and share your own tactics'}
        icon={Icons.pencil('h-6 w-6')}
        right={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} title="Import puzzles from a JSON file">
              <UploadIcon /> Import
            </Button>
            {hasAny && (
              <Button size="sm" variant="ghost" onClick={() => void onExport()} title="Download all puzzles as JSON">
                <DownloadIcon /> Export all
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => navigate('/custom/new')}>
              <span className="text-lg leading-none">+</span> New puzzle
            </Button>
          </div>
        }
      />
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onImport(e.target.files?.[0])} />

      {puzzles === undefined ? (
        <div className="p-10 text-center text-ink-400">Loading…</div>
      ) : !hasAny ? (
        <EmptyState onCreate={() => navigate('/custom/new')} onImport={() => fileInput.current?.click()} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title or theme"
                className="w-full rounded-xl border border-ink-700 bg-ink-850 py-2.5 pl-9 pr-3 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-ember-500"
              />
            </div>
            <div className="flex gap-1 rounded-xl bg-ink-850 p-1">
              {(
                [
                  ['recent', 'Recent'],
                  ['easy', 'Easiest'],
                  ['hard', 'Hardest'],
                ] as [SortKey, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition sm:flex-none ${sort === k ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <Panel className="py-10 text-center text-ink-400">No puzzles match “{query}”.</Panel>
          ) : (
            <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {shown.slice(0, limit).map((p) => (
                <PuzzleCard
                  key={p.id}
                  puzzle={p}
                  highlight={p.id === highlight}
                  onPlay={() => navigate(`/custom/play/${p.id}`)}
                  onEdit={() => navigate(`/custom/edit/${p.id}`)}
                  onShare={() => share(draftOf(p))}
                  onDelete={() => setToDelete(p)}
                />
              ))}
            </div>
          )}
          {shown.length > limit && (
            <div className="mt-5 flex justify-center">
              <Button onClick={() => setLimit((l) => l + PAGE)}>Show more ({shown.length - limit} left)</Button>
            </div>
          )}
        </>
      )}

      <Modal open={!!toDelete} onClose={() => setToDelete(null)}>
        <h2 className="text-lg font-extrabold">Delete this puzzle?</h2>
        <p className="mt-2 text-sm text-ink-400">
          “{toDelete ? displayTitle(toDelete) : ''}” will be removed from this device. Share links you sent keep working, since the puzzle lives in the link.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setToDelete(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirmDelete()} autoFocus>
            Delete
          </Button>
        </div>
      </Modal>

      <Modal open={!!report} onClose={() => setReport(null)}>
        <h2 className="text-lg font-extrabold">Import report</h2>
        {report && (
          <>
            <p className="mt-2 text-sm text-ink-300">
              <span className="font-bold text-good-400">{report.added} added</span>
              {report.duplicates > 0 && <> · {report.duplicates} already saved</>}
              {' · '}
              <span className="font-bold text-bad-400">{report.errors.length} skipped</span>
            </p>
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-xl bg-ink-900 p-3 text-xs text-ink-300">
              {report.errors.slice(0, 50).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {report.errors.length > 50 && <li className="text-ink-500">…and {report.errors.length - 50} more</li>}
            </ul>
          </>
        )}
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => setReport(null)}>
            OK
          </Button>
        </div>
      </Modal>
      {shareModal}
    </>
  );
}

function EmptyState({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <Panel className="relative mx-auto max-w-xl overflow-hidden px-6 py-12 text-center">
      <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-48 rounded-full bg-ember-500/20 blur-3xl" />
      <div className="relative mx-auto mb-6 flex w-fit items-end justify-center gap-1">
        {(['wR', 'wN', 'wQ', 'bK'] as const).map((c, i) => (
          <img
            key={c}
            src={pieceUrl(c)}
            alt=""
            draggable={false}
            className={`animate-pop drop-shadow-[0_8px_14px_rgb(0_0_0/0.45)] ${i === 2 ? 'h-20 w-20' : 'h-14 w-14'}`}
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
      <h2 className="relative text-2xl font-extrabold">Craft your first puzzle</h2>
      <p className="relative mx-auto mt-2 max-w-sm text-sm text-ink-400">
        Set up any position, play the winning line, and challenge yourself — or send it to a friend with a single link.
      </p>
      <div className="relative mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" size="lg" onClick={onCreate}>
          {Icons.pencil('h-5 w-5')} Create a puzzle
        </Button>
        <Button size="lg" variant="ghost" onClick={onImport}>
          <UploadIcon /> Import file
        </Button>
      </div>
    </Panel>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
    </svg>
  );
}
