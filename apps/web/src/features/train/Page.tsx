import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { GamesPage } from './GamesPage.tsx';
import { GamesTrainer } from './GamesTrainer.tsx';
import { ReviewTrainer } from './ReviewTrainer.tsx';
import { ThemeTrainer } from './ThemeTrainer.tsx';
import { TrainHub } from './TrainHub.tsx';

const OpeningsPage = lazy(() => import('../openings/Page.tsx'));
const EndgamesPage = lazy(() => import('../endgames/Page.tsx'));

/**
 * Train (all unrated).
 *   /train                 hub: review queue + theme picker
 *   /train/theme/:keys     theme session ("fork+pin", ?d=easier|normal|harder)
 *   /train/review          spaced-repetition review of missed puzzles
 *   /train/games           puzzles from your own analysed games (due / all / bulk add)
 *   /train/games/play      their session (?m=due|all)
 *   /train/openings/*      opening trainer
 *   /train/endgames/*      endgame drills (tablebase)
 */
export default function TrainPage() {
  return (
    <Routes>
      <Route index element={<TrainHub />} />
      <Route path="theme/:keys" element={<ThemeTrainerRoute />} />
      <Route path="review" element={<ReviewTrainer />} />
      <Route path="games" element={<GamesPage />} />
      <Route path="games/play" element={<GamesTrainerRoute />} />
      <Route path="openings/*" element={<Suspense fallback={null}><OpeningsPage /></Suspense>} />
      <Route path="endgames/*" element={<Suspense fallback={null}><EndgamesPage /></Suspense>} />
      <Route path="*" element={<Navigate to="/train" replace />} />
    </Routes>
  );
}

/** Keyed so that choosing other themes/difficulty starts a fresh session. */
function ThemeTrainerRoute() {
  const { keys } = useParams();
  const [params] = useSearchParams();
  return <ThemeTrainer key={`${keys}?${params.get('d') ?? ''}`} />;
}

/** Keyed so that switching between due and all starts a fresh queue. */
function GamesTrainerRoute() {
  const [params] = useSearchParams();
  return <GamesTrainer key={params.get('m') ?? ''} />;
}
