import { Icons, PageHeader, Panel } from '../../shared/ui.tsx';

/** Placeholder: replaced by builder B. */
export default function StatsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Stats" subtitle="Your progress at a glance" icon={Icons.chart('h-6 w-6')} />
      <Panel>
        <p className="text-ink-400">Coming soon.</p>
      </Panel>
    </div>
  );
}
