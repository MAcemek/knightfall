import { Link, Route, Routes, useParams } from 'react-router-dom';
import { Panel } from '../../shared/ui.tsx';
import { ToastProvider } from './bits.tsx';
import { Editor } from './editor/Editor.tsx';
import { PuzzleList } from './list/PuzzleList.tsx';
import { PlayCustom } from './play/PlayCustom.tsx';
import { PlayShared } from './play/PlayShared.tsx';

/**
 * Custom Puzzles: build positions, record solutions, play and share them.
 *   /custom            my puzzles
 *   /custom/new        editor
 *   /custom/edit/:id   editor (existing)
 *   /custom/play/:id   play a saved puzzle
 *   /custom/s#<data>   play a shared puzzle from the link
 */
export default function CustomPage() {
  return (
    <ToastProvider>
      <Routes>
        <Route index element={<PuzzleList />} />
        <Route path="new" element={<Editor key="new" />} />
        <Route path="edit/:id" element={<EditRoute />} />
        <Route path="play/:id" element={<PlayCustom />} />
        <Route path="s" element={<PlayShared />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ToastProvider>
  );
}

function EditRoute() {
  const { id } = useParams();
  return <Editor key={id} id={id} />;
}

function NotFound() {
  return (
    <Panel className="mx-auto max-w-md space-y-3 text-center">
      <p className="text-lg font-bold">Nothing here</p>
      <Link to="/custom" className="font-semibold text-ember-400 hover:text-ember-300">
        Back to my puzzles →
      </Link>
    </Panel>
  );
}
