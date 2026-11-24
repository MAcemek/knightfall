import { Navigate, Route, Routes } from 'react-router-dom';
import { WoodIndex } from './WoodIndex.tsx';
import { WoodMisses } from './WoodMisses.tsx';
import { WoodPlay } from './WoodPlay.tsx';
import { WoodSetPage } from './WoodSetPage.tsx';

/**
 * Woodpecker sets, mounted at /train/woodpecker/*.
 *   /train/woodpecker              your sets and a new one
 *   /train/woodpecker/:id          pace, cycles and misses of one set
 *   /train/woodpecker/:id/play     the current cycle, first unplayed puzzle first
 *   /train/woodpecker/:id/misses   the misses of the current cycle, practice only
 */
export default function WoodpeckerPage() {
  return (
    <Routes>
      <Route index element={<WoodIndex />} />
      <Route path=":id" element={<WoodSetPage />} />
      <Route path=":id/play" element={<WoodPlay />} />
      <Route path=":id/misses" element={<WoodMisses />} />
      <Route path="*" element={<Navigate to="/train/woodpecker" replace />} />
    </Routes>
  );
}
