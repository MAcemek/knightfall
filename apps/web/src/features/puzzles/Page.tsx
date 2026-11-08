import { Navigate, Route, Routes } from 'react-router-dom';
import { RatedTrainer } from './RatedTrainer.tsx';

/** /puzzles — rated tactics trainer. */
export default function PuzzlesPage() {
  return (
    <Routes>
      <Route index element={<RatedTrainer />} />
      <Route path="*" element={<Navigate to="/puzzles" replace />} />
    </Routes>
  );
}
