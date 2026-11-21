import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { VisionHome } from './VisionHome.tsx';
import { VisionPlay } from './VisionPlay.tsx';
import { isDrill, parseColor } from './visionLogic.ts';

/**
 * Board vision drills (unrated), mounted at /train/vision/*.
 *   /train/vision          pick a drill and a side
 *   /train/vision/:drill   one timed run (find | name | knight), ?c=w|b for the side the board is seen from
 */
export default function VisionPage() {
  return (
    <Routes>
      <Route index element={<VisionHome />} />
      <Route path=":drill" element={<PlayRoute />} />
      <Route path="*" element={<Navigate to="/train/vision" replace />} />
    </Routes>
  );
}

function PlayRoute() {
  const { drill } = useParams();
  const [params] = useSearchParams();
  if (!isDrill(drill)) return <Navigate to="/train/vision" replace />;
  const color = parseColor(params.get('c'));
  return <VisionPlay key={`${drill}-${color}`} drill={drill} color={color} />;
}
