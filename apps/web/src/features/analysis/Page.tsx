import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ImportPage } from './import/ImportPage.tsx';
import { ReviewPage } from './review/ReviewPage.tsx';

/**
 * Game Review.
 *   /analysis             import a game (link, PGN or username) and list recent reviews
 *   /analysis/:gameKey    the review of one stored game (StoredGame.key, e.g. "li-HqjDTU4A")
 *
 * This file only routes. The import UI lives in ./import/, the review UI in ./review/.
 */
export default function AnalysisPage() {
  return (
    <Routes>
      <Route index element={<ImportPage />} />
      <Route path=":gameKey" element={<ReviewRoute />} />
      <Route path="*" element={<Navigate to="/analysis" replace />} />
    </Routes>
  );
}

/** Keyed so that opening another game starts from a clean component state. */
function ReviewRoute() {
  const { gameKey = '' } = useParams();
  return <ReviewPage key={gameKey} gameKey={gameKey} />;
}
