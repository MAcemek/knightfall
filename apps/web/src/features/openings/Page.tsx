import { Navigate, Route, Routes } from 'react-router-dom';
import { OpeningDrill } from './OpeningDrill.tsx';
import { OpeningsHome } from './OpeningsHome.tsx';

/**
 * Opening trainer, mounted at /train/openings/*.
 *   /train/openings                          pick families, see what is due
 *   /train/openings/drill?f=Italian+Game&c=w drill one family as White (c=w) or Black (c=b)
 */
export default function OpeningsPage() {
  return (
    <Routes>
      <Route index element={<OpeningsHome />} />
      <Route path="drill" element={<OpeningDrill />} />
      <Route path="*" element={<Navigate to="/train/openings" replace />} />
    </Routes>
  );
}
