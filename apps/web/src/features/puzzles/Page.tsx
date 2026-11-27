import { Navigate, Route, Routes } from 'react-router-dom';
import { RatedTrainer } from './RatedTrainer.tsx';
import { StartLevelGate } from './StartLevelGate.tsx';

/** /puzzles — rated tactics trainer. */
export default function PuzzlesPage() {
  return (
    <Routes>
      <Route index element={<StartLevelGate><RatedTrainer /></StartLevelGate>} />
      <Route path="*" element={<Navigate to="/puzzles" replace />} />
    </Routes>
  );
}
