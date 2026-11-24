import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { BlunderHome } from './BlunderHome.tsx';
import { BlunderPlay } from './BlunderPlay.tsx';

/**
 * Blunder check (unrated), mounted at /train/blunder-check/*.
 *   /train/blunder-check        pick the source and the mode, see the totals
 *   /train/blunder-check/play   a session, ?s=games|puzzles and ?m=quick|full
 */
export default function BlunderCheckPage() {
  return (
    <Routes>
      <Route index element={<BlunderHome />} />
      <Route path="play" element={<PlayRoute />} />
      <Route path="*" element={<Navigate to="/train/blunder-check" replace />} />
    </Routes>
  );
}

function PlayRoute() {
  const [params] = useSearchParams();
  const source = params.get('s') === 'games' ? 'games' : 'puzzles';
  const mode = params.get('m') === 'full' ? 'full' : 'quick';
  return <BlunderPlay key={`${source}-${mode}`} source={source} mode={mode} />;
}
