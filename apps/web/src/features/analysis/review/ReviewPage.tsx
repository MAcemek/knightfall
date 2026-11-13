import { Link } from 'react-router-dom';
import { Icons, PageHeader, Panel } from '../../../shared/ui.tsx';

/** Placeholder: builder B replaces this file. Keep the named export `ReviewPage` and its `gameKey` prop. */
export function ReviewPage({ gameKey }: { gameKey: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Game Review" subtitle={gameKey} icon={Icons.search('h-6 w-6')} />
      <Panel className="space-y-3 text-center text-ink-400">
        <p>The review screen is being built.</p>
        <Link to="/analysis" className="font-bold text-ember-400">
          Back to Game Review
        </Link>
      </Panel>
    </div>
  );
}
