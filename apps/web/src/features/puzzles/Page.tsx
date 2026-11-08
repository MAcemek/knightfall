import { useEffect, useState } from 'react';
import type { Puzzle } from '@knightfall/core';
import { PuzzleBoard, PuzzlePrompt, usePuzzleRunner } from '../../shared/PuzzlePlayer/index.ts';
import { puzzleNear } from '../../shared/puzzleSource.ts';
import { Button, GameLayout, PageHeader, Panel, Icons } from '../../shared/ui.tsx';

/**
 * PLACEHOLDER (foundation smoke test) — replaced by the rated Puzzles feature.
 * Shows the minimal wiring: load a puzzle → usePuzzleRunner → <PuzzleBoard/>.
 */
export default function PuzzlesPage() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const runner = usePuzzleRunner(puzzle);
  const next = () => void puzzleNear(1200).then(setPuzzle);
  useEffect(next, []);
  return (
    <>
      <PageHeader title="Puzzles" subtitle="Placeholder" icon={Icons.puzzle('h-6 w-6')} />
      <GameLayout
        board={<PuzzleBoard runner={runner} />}
        side={
          <Panel className="space-y-4">
            <PuzzlePrompt runner={runner} />
            <div className="text-sm text-ink-400">Rating {puzzle?.rating}</div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={runner.hint}>Hint</Button>
              <Button onClick={runner.retry}>Retry</Button>
              <Button onClick={runner.showSolution}>Solution</Button>
              <Button variant="primary" onClick={next}>Next</Button>
            </div>
          </Panel>
        }
      />
    </>
  );
}
