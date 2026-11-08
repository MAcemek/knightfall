import { useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Lobby } from './Lobby.tsx';
import { RushGame } from './RushGame.tsx';
import { isRushMode } from './rushLogic.ts';

/**
 * Puzzle Rush.
 *   /rush               lobby (mode picker, personal bests)
 *   /rush/play/:mode    a run (3min | 5min | survival)
 */
export default function RushPage() {
  return (
    <Routes>
      <Route index element={<Lobby />} />
      <Route path="play/:mode" element={<PlayRoute />} />
      <Route path="*" element={<Navigate to="/rush" replace />} />
    </Routes>
  );
}

function PlayRoute() {
  const { mode } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(0);
  if (!isRushMode(mode)) return <Navigate to="/rush" replace />;
  return (
    <RushGame
      key={`${mode}-${run}`}
      mode={mode}
      onPlayAgain={() => {
        window.scrollTo({ top: 0 });
        setRun((r) => r + 1);
      }}
      onChangeMode={() => navigate('/rush')}
    />
  );
}
