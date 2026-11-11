import { Icons, PageHeader, Panel } from '../../shared/ui.tsx';

/** Placeholder: replaced by the train builder. */
export default function TrainPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Train" subtitle="Theme training and your review queue" icon={Icons.target('h-6 w-6')} />
      <Panel>
        <p className="text-ink-400">Coming soon.</p>
      </Panel>
    </div>
  );
}
