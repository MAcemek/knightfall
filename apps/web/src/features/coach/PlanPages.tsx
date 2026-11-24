import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAnalysisPrefs } from '../../shared/analysis/index.ts';
import { Button, Modal, Panel } from '../../shared/ui.tsx';
import { blankForm, formFromPlan } from './formLogic.ts';
import { PlanForm } from './PlanForm.tsx';
import type { CoachPlan } from './planLogic.ts';
import { removePlan, savePlan } from './planStore.ts';
import { useLocalToday } from './todayStore.ts';

/** /coach without a plan, and /coach/settings with one. */

async function save(plan: CoachPlan): Promise<string | null> {
  return (await savePlan(plan)) ? null : 'The plan could not be saved. Check the start date and the ratings.';
}

export function SetupPage() {
  const prefs = useAnalysisPrefs();
  const today = useLocalToday();
  return (
    <Panel>
      <h2 className="text-lg font-extrabold">Set up your 12 weeks</h2>
      <p className="mb-4 mt-1 text-sm text-ink-400">A daily list of short tasks, a limit on bullet and a stop rule for blitz. Takes a minute.</p>
      {prefs === undefined ? (
        <p className="text-sm text-ink-400" role="status">
          Loading.
        </p>
      ) : (
        <PlanForm initial={blankForm(prefs.chesscomUser, today)} submitLabel="Start the plan" onSubmit={save} />
      )}
    </Panel>
  );
}

export function SettingsPage({ plan }: { plan: CoachPlan }) {
  const today = useLocalToday();
  const nav = useNavigate();
  const fresh = (useLocation().state as { fresh?: boolean } | null)?.fresh === true;
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saved, setSaved] = useState(false);

  const remove = async () => {
    setRemoving(true);
    try {
      await removePlan();
      nav('/coach', { replace: true });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="text-lg font-extrabold">{fresh ? 'Start a new plan' : 'Plan settings'}</h2>
        <p className="mb-4 mt-1 text-sm text-ink-400">{fresh ? 'Pick a start date and your ratings today.' : 'Change the start date, the ratings or the targets.'}</p>
        <PlanForm
          key={fresh ? 'fresh' : `edit-${plan.startDate}-${plan.username}`}
          initial={fresh ? blankForm(plan.username, today) : formFromPlan(plan)}
          submitLabel={fresh ? 'Start the plan' : 'Save changes'}
          note="Everything stays in this browser."
          onSubmit={async (p) => {
            setSaved(false);
            const failed = await save(p);
            if (!failed) {
              setSaved(true);
              if (fresh) nav('/coach/settings', { replace: true, state: null });
            }
            return failed;
          }}
        />
        {saved && (
          <p className="mt-3 text-sm font-semibold text-good-400" role="status">
            Saved.
          </p>
        )}
      </Panel>
      <Panel>
        <h2 className="text-lg font-extrabold">Remove the plan</h2>
        <p className="mb-3 mt-1 text-sm text-ink-400">Removes the plan and the games synced for it. Your ticks, rating history, Woodpecker sets, reviews and notes stay.</p>
        <Button variant="danger" onClick={() => setAsking(true)}>
          Remove the plan
        </Button>
      </Panel>
      <Modal open={asking} onClose={() => setAsking(false)} label="Remove the plan">
        <h2 className="text-lg font-extrabold">Remove the plan?</h2>
        <p className="mt-2 text-sm text-ink-300">The plan and the games synced for it are removed. Your ticks, rating history, Woodpecker sets, reviews and notes stay. You can start a new plan any time.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="danger" disabled={removing} onClick={() => void remove()}>
            Remove
          </Button>
          <Button variant="secondary" onClick={() => setAsking(false)}>
            Keep the plan
          </Button>
        </div>
      </Modal>
    </div>
  );
}
