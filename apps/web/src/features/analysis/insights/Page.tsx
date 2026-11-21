import { Link } from 'react-router-dom';
import { EmptyState, Icons, PageHeader, Panel, Pill, Stat } from '../../../shared/ui.tsx';
import { themeLabel } from '../../../shared/themes.ts';
import { AccuracyChart } from './AccuracyChart.tsx';
import { MIN_INSIGHT_GAMES, motifSummary, updateLine, type MotifRow, type OpeningRow, type PhaseRow } from './insightsLogic.ts';
import { useInsightsData } from './useInsightsData.ts';

const PHASE_LABEL = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' } as const;

const pct = (v: number | null) => (v === null ? '–' : `${v.toFixed(1)}%`);
const rate = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** /analysis/insights: patterns across every reviewed game where we know which side is yours. */
export default function InsightsPage() {
  const { data, reviews, updating } = useInsightsData();

  const header = <PageHeader title="Insights" subtitle="What your reviewed games say about your play" icon={Icons.chart('h-6 w-6')} />;
  if (!data) {
    return (
      <div className="mx-auto max-w-5xl">
        {header}
        <p className="p-10 text-center text-ink-400">Loading…</p>
      </div>
    );
  }

  const progress = updating && (
    <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-ink-800/70 px-4 py-3 text-sm text-ink-200">
      <span className="h-2 w-2 animate-pulse rounded-full bg-ember-400" />
      {updateLine(updating.done, updating.total)}
      <span className="text-ink-400">(new move insights, runs in the background)</span>
    </p>
  );

  if (data.games < MIN_INSIGHT_GAMES) {
    return (
      <div className="mx-auto max-w-5xl">
        {header}
        {progress}
        <EmptyState
          icon={Icons.search('h-6 w-6')}
          title={`Review ${MIN_INSIGHT_GAMES} games to see insights`}
          action={<Link to="/analysis" className="font-bold text-ember-400">Import games</Link>}
        >
          {data.games === 0 ? 'No usable reviews yet.' : `${data.games} usable ${data.games === 1 ? 'review' : 'reviews'} so far.`}{' '}
          {data.unknownSide > 0
            ? `${data.unknownSide} of ${reviews} ${reviews === 1 ? 'review was' : 'reviews were'} skipped because we do not know which side is yours. Import by username to fix that.`
            : 'Import games by your username, review them, and your patterns show up here.'}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {header}
      {progress}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Games" value={data.games} sub={`reviewed as you`} />
        <Stat label="Accuracy" value={pct(data.accuracy.overall)} accent="text-good-400" sub="average" />
        <Stat label="As White" value={pct(data.accuracy.white)} sub={`${data.accuracy.whiteGames} ${data.accuracy.whiteGames === 1 ? 'game' : 'games'}`} />
        <Stat label="As Black" value={pct(data.accuracy.black)} sub={`${data.accuracy.blackGames} ${data.accuracy.blackGames === 1 ? 'game' : 'games'}`} />
      </div>

      <Panel>
        <h2 className="mb-3 text-lg font-extrabold">Accuracy over time</h2>
        {data.accuracySeries.length >= 2 ? <AccuracyChart points={data.accuracySeries} /> : <p className="text-sm text-ink-400">Needs two games with an accuracy score.</p>}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-lg font-extrabold">Accuracy by phase</h2>
          <PhaseBars rows={data.phases} weakest={data.weakestPhase} />
        </Panel>
        <Panel>
          <h2 className="mb-3 text-lg font-extrabold">Per game</h2>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Blunders" value={rate(data.perGame.blunder)} accent="text-bad-400" sub={`${data.totals.blunder} total`} />
            <Stat label="Mistakes" value={rate(data.perGame.mistake)} accent="text-ember-400" sub={`${data.totals.mistake} total`} />
            <Stat label="Misses" value={rate(data.perGame.miss)} sub={`${data.totals.miss} total`} />
          </div>
          <p className="mt-3 text-xs text-ink-400">Average count in each of your games.</p>
        </Panel>
      </div>

      <Panel>
        <h2 className="mb-1 text-lg font-extrabold">Your most common mistakes</h2>
        <p className="mb-3 text-sm text-ink-400">Only moves you played that lost ground, grouped by what went wrong.</p>
        {data.motifs.length === 0 ? <p className="text-sm text-ink-400">No mistakes with a clear cause found yet.</p> : <div className="space-y-3">{data.motifs.map((m) => <MotifCard key={m.motif} row={m} />)}</div>}
      </Panel>

      <Panel>
        <h2 className="mb-3 text-lg font-extrabold">Openings you play</h2>
        {data.openings.length === 0 ? <p className="text-sm text-ink-400">Openings you have played at least twice show up here.</p> : <OpeningList rows={data.openings} />}
      </Panel>

      {(data.unknownSide > 0 || data.outdated > 0) && (
        <p className="px-1 text-xs text-ink-500">
          {data.unknownSide > 0 && `${data.unknownSide} ${data.unknownSide === 1 ? 'review' : 'reviews'} skipped: we do not know which side was yours (import by username). `}
          {data.outdated > 0 && !updating && `${data.outdated} ${data.outdated === 1 ? 'review' : 'reviews'} skipped: it could not be updated.`}
        </p>
      )}
    </div>
  );
}

function PhaseBars({ rows, weakest }: { rows: PhaseRow[]; weakest: PhaseRow['phase'] | null }) {
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.phase}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-semibold">
              {PHASE_LABEL[r.phase]}
              {weakest === r.phase && <Pill className="bg-bad-500/20 text-bad-400">Weakest</Pill>}
            </span>
            <span className="font-mono font-bold">{pct(r.accuracy)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-ink-800">
            <div className={`h-full rounded-full ${weakest === r.phase ? 'bg-bad-400' : 'bg-ember-400'}`} style={{ width: `${Math.max(0, Math.min(100, r.accuracy ?? 0))}%` }} />
          </div>
        </div>
      ))}
      {weakest && <p className="text-sm text-ink-300">Your {PHASE_LABEL[weakest].toLowerCase()} is where the most accuracy slips away.</p>}
    </div>
  );
}

function MotifCard({ row }: { row: MotifRow }) {
  return (
    <div className="rounded-xl bg-ink-800/70 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="font-bold">{row.label}</div>
          <div className="text-sm text-ink-400">{motifSummary(row.count, row.games)}</div>
        </div>
        {row.theme && (
          <Link to={`/train/theme/${row.theme}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold text-ember-400 hover:underline">
            {Icons.target('h-4 w-4')} Train this
          </Link>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {row.examples.map((ex) => (
          <Link
            key={`${ex.gameKey}-${ex.ply}`}
            to={ex.href}
            title={`vs ${ex.opponent}`}
            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl bg-ink-700 px-3 text-sm font-semibold text-ink-100 hover:bg-ink-600"
          >
            <span className="font-mono">{ex.moveNumber}{ex.color === 'w' ? '.' : '...'} {ex.san}</span>
            <span className="truncate text-xs text-ink-400">vs {ex.opponent}</span>
          </Link>
        ))}
      </div>
      {row.theme && <p className="mt-1.5 text-xs text-ink-500">Practice: {themeLabel(row.theme)} puzzles</p>}
    </div>
  );
}

function OpeningList({ rows }: { rows: OpeningRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map((o) => (
        <div key={o.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-ink-800/70 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{o.name}</div>
            <div className="text-xs text-ink-400">
              {o.eco ? `${o.eco} · ` : ''}{o.games} games · {o.wins}W {o.draws}D {o.losses}L
            </div>
          </div>
          <div className="flex gap-4 text-right font-mono text-sm">
            <div>
              <div className="font-bold">{o.score === null ? '–' : `${Math.round(o.score * 100)}%`}</div>
              <div className="text-xs text-ink-400">score</div>
            </div>
            <div>
              <div className="font-bold">{pct(o.accuracy)}</div>
              <div className="text-xs text-ink-400">accuracy</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

