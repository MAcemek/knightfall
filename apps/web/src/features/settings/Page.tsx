import { Icons, PageHeader, Panel } from '../../shared/ui.tsx';

/** Placeholder: replaced by builder B. */
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" subtitle="Sound, board and animations" icon={Icons.sliders('h-6 w-6')} />
      <Panel>
        <p className="text-ink-400">Coming soon.</p>
      </Panel>
    </div>
  );
}
