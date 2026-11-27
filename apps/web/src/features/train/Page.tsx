import { lazy } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { GamesPage } from './GamesPage.tsx';
import { GamesTrainer } from './GamesTrainer.tsx';
import { ReviewTrainer } from './ReviewTrainer.tsx';
import { ThemeTrainer } from './ThemeTrainer.tsx';
import { TrainHub } from './TrainHub.tsx';
import { WeakTrainer } from './WeakTrainer.tsx';

// No Suspense of their own: they suspend to the app-wide boundary, which keeps the Train hub on screen while
// the code loads and then plays the page entrance on the trainer itself.
const OpeningsPage = lazy(() => import('../openings/Page.tsx'));
const EndgamesPage = lazy(() => import('../endgames/Page.tsx'));
const WoodpeckerPage = lazy(() => import('../woodpecker/Page.tsx'));
const BlunderCheckPage = lazy(() => import('../blundercheck/Page.tsx'));
const VisionPage = lazy(() => import('../vision/Page.tsx'));

/**
 * Train (all unrated).
 *   /train                 hub: review queue + theme picker
 *   /train/theme/:keys     theme session ("fork+pin", ?d=easier|normal|harder)
 *   /train/weak            your weakest themes, picked for you
 *   /train/review          spaced-repetition review of missed puzzles
 *   /train/games           puzzles from your own analysed games (due / all / bulk add)
 *   /train/games/play      their session (?m=due|all)
 *   /train/woodpecker/*    one fixed puzzle set, repeated faster every cycle
 *   /train/blunder-check/* is this move safe? (checks, captures, threats)
 *   /train/openings/*      opening trainer
 *   /train/endgames/*      endgame drills (tablebase)
 *   /train/vision/*        board vision drills (find / name the square, knight routes)
 */
export default function TrainPage() {
  return (
    <Routes>
      <Route index element={<TrainHub />} />
      <Route path="theme/:keys" element={<ThemeTrainerRoute />} />
      <Route path="weak" element={<WeakTrainer />} />
      <Route path="review" element={<ReviewTrainer />} />
      <Route path="games" element={<GamesPage />} />
      <Route path="games/play" element={<GamesTrainerRoute />} />
      <Route path="woodpecker/*" element={<WoodpeckerPage />} />
      <Route path="blunder-check/*" element={<BlunderCheckPage />} />
      <Route path="openings/*" element={<OpeningsPage />} />
      <Route path="endgames/*" element={<EndgamesPage />} />
      <Route path="vision/*" element={<VisionPage />} />
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
