import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { GAME_PUZZLE_PREFIX } from '@knightfall/core';
import { addAllGamePuzzles, countNewGamePuzzles, orderGamePuzzles } from '../../shared/analysis/index.ts';
import { db } from '../../shared/db.ts';
import { toast } from '../../shared/toast.tsx';
import { Button, EmptyState, Icons, PageHeader, Panel } from '../../shared/ui.tsx';

/** /train/games — your game puzzles: how many are due, practise them, or add them from every analysed game. */
export function GamesPage() {
  const navigate = useNavigate();
  const counts = useLiveQuery(async () => {
    const ids = (await db.customPuzzles.where('id').startsWith(GAME_PUZZLE_PREFIX).primaryKeys()) as string[];
    const due = orderGamePuzzles(ids, await db.reviews.toArray(), Date.now(), 'due').length;
    return { total: ids.length, due };
  }, []);
  const fresh = useLiveQuery(countNewGamePuzzles, []);
  const [busy, setBusy] = useState(false);

  const addAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const added = await addAllGamePuzzles();
      toast({ title: added > 0 ? `Added ${added} puzzle${added === 1 ? '' : 's'} from your games` : 'No new puzzles found', icon: 'target', tone: 'good' });
    } catch {
      toast({ title: 'Could not add the puzzles', body: 'Please try again.', icon: 'x', tone: 'ember' });
    } finally {
      setBusy(false);
    }
  };

  const total = counts?.total ?? 0;
  const due = counts?.due ?? 0;
  const addButton = (
    <Button variant={total ? 'secondary' : 'primary'} disabled={busy || !fresh} onClick={() => void addAll()}>
      {Icons.layers('h-4 w-4')} Add from all analysed games ({fresh ?? 0} new)
    </Button>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="From my games"
        subtitle="Mistakes from your analysed games, as puzzles. Nothing here changes your rating."
        icon={Icons.target('h-6 w-6')}
        right={
          <Link to="/train" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition-colors hover:text-ink-100">
            Back to Train
          </Link>
        }
      />
      {counts && total === 0 ? (
        <EmptyState
          icon={Icons.target('h-6 w-6')}
          title="No game puzzles yet"
          action={
            <div className="flex flex-col items-center gap-3">
              {addButton}
              <Link to="/analysis" className="font-bold text-ember-400">
                Analyse a game
              </Link>
            </div>
          }
        >
          Analyse a game in Game Review and its mistakes show up here automatically, once Knightfall knows which side you played.
        </EmptyState>
      ) : (
        <Panel className="animate-rise space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-extrabold">Your game puzzles</h2>
            <span className="font-mono text-sm text-ink-400">
              {due} due · {total} total
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" disabled={!due} onClick={() => navigate('/train/games/play?m=due')}>
              {Icons.target('h-4 w-4')} {due ? `Practise due (${due})` : 'Nothing due'}
            </Button>
            <Button variant="secondary" disabled={!total} onClick={() => navigate('/train/games/play?m=all')}>
              Practise all ({total})
            </Button>
          </div>
          <div className="border-t border-ink-700/60 pt-4">{addButton}</div>
          <p className="text-sm text-ink-500">Games where Knightfall cannot tell which side you played are skipped. Pick a side in Game Review to add them one by one.</p>
        </Panel>
      )}
    </div>
  );
}
