import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { ReviewTrainer } from './ReviewTrainer.tsx';
import { ThemeTrainer } from './ThemeTrainer.tsx';
import { TrainHub } from './TrainHub.tsx';

/**
 * Train (all unrated).
 *   /train                 hub: review queue + theme picker
 *   /train/theme/:keys     theme session ("fork+pin", ?d=easier|normal|harder)
 *   /train/review          spaced-repetition review of missed puzzles
 */
export default function TrainPage() {
  return (
    <Routes>
      <Route index element={<TrainHub />} />
      <Route path="theme/:keys" element={<ThemeTrainerRoute />} />
      <Route path="review" element={<ReviewTrainer />} />
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
