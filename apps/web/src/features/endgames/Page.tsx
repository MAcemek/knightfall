import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { DrillView } from './components/DrillView.tsx';
import { EndgameList } from './components/EndgameList.tsx';
import { findEndgame } from './positions.ts';

/**
 * Endgame drills (unrated), mounted at /train/endgames/*.
 *   /train/endgames        list of curated positions
 *   /train/endgames/:id    one drill against the Lichess tablebase
 */
export default function EndgamesPage() {
  return (
    <Routes>
      <Route index element={<EndgameList />} />
      <Route path=":id" element={<DrillRoute />} />
      <Route path="*" element={<Navigate to="/train/endgames" replace />} />
    </Routes>
  );
}

function DrillRoute() {
  const { id } = useParams();
  const position = findEndgame(id);
  if (!position) return <Navigate to="/train/endgames" replace />;
  return <DrillView key={position.id} position={position} />;
}
