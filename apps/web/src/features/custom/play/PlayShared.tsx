import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { hashString, type Puzzle } from '@knightfall/core';
import type { CustomPuzzle } from '../../../shared/db.ts';
import { burstAt, PALETTES, sfx } from '../../../shared/fx/index.ts';
import { Button, Icons, PageHeader, Panel } from '../../../shared/ui.tsx';
import { useToast } from '../bits.tsx';
import { decodeShare } from '../logic.ts';
import { findDuplicate, recordPlay, saveCustom } from '../store.ts';
import { CustomPlayer } from './CustomPlayer.tsx';

/** /custom/s#<data> — play a puzzle someone shared; optionally save it locally. */
export function PlayShared() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const decoded = useMemo(() => decodeShare(hash), [hash]);
  const [saved, setSaved] = useState<CustomPuzzle | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const saveBtn = useRef<HTMLDivElement>(null);

  const puzzle = useMemo<Puzzle | null>(() => {
    if (!decoded.ok) return null;
    const d = decoded.draft;
    return {
      id: `shared_${hashString(hash).toString(36)}`,
      fen: d.fen,
      moves: d.moves,
      opponentFirst: d.opponentFirst,
      rating: d.rating,
      themes: d.themes,
      title: d.title || undefined,
      source: 'custom',
    };
  }, [decoded, hash]);

  // Already in my puzzles? (same position + line)
  useEffect(() => {
    setSaved(null);
    if (!decoded.ok) return;
    let alive = true;
    setChecking(true);
    void findDuplicate(decoded.draft).then((p) => {
      if (!alive) return;
      setSaved(p ?? null);
      setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, [decoded]);

  const header = (
    <PageHeader
      title="Shared puzzle"
      icon={Icons.share('h-6 w-6')}
      right={
        <Link to="/custom" className="text-sm font-semibold text-ink-400 transition hover:text-ink-100">
          My puzzles →
        </Link>
      }
    />
  );

  if (!decoded.ok || !puzzle) {
    return (
      <>
        {header}
        <Panel className="mx-auto max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-bad-500/15 text-bad-400">{Icons.x('h-7 w-7')}</div>
          <p className="text-lg font-bold">This puzzle link doesn't work</p>
          <p className="text-sm text-ink-400">{decoded.ok ? 'Something went wrong.' : decoded.error} Ask the sender to copy the link again.</p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => navigate('/custom')}>My puzzles</Button>
            <Button variant="primary" onClick={() => navigate('/custom/new')}>
              Make your own
            </Button>
          </div>
        </Panel>
      </>
    );
  }

  const save = async () => {
    if (busy || saved) return;
    setBusy(true);
    try {
      const p = await saveCustom(decoded.draft);
      setSaved(p);
      sfx.solved();
      burstAt(saveBtn.current, { count: 30, colors: PALETTES.good, power: 6 });
      toast('Saved to my puzzles');
    } catch (e) {
      sfx.wrong();
      toast(`Could not save: ${(e as Error).message}`, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {header}
      <CustomPlayer
        puzzle={puzzle}
        kicker="Shared with you"
        onResult={(r) => {
          if (saved) void recordPlay(saved, r);
        }}
        actions={
          <div ref={saveBtn} className="w-full">
            {saved ? (
              <div className="flex w-full flex-wrap items-center gap-2">
                <span className="flex animate-pop items-center gap-1.5 text-sm font-semibold text-good-400">
                  {Icons.check('h-4 w-4')} In your puzzles
                </span>
                <Button size="sm" className="ml-auto" onClick={() => navigate(`/custom/edit/${saved.id}`)}>
                  {Icons.pencil('h-4 w-4')} Edit copy
                </Button>
              </div>
            ) : (
              <Button variant="good" className="w-full" onClick={() => void save()} disabled={busy || checking}>
                {Icons.check('h-4 w-4')} Save to my puzzles
              </Button>
            )}
          </div>
        }
      />
    </>
  );
}
