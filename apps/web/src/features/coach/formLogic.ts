import type { CoachSpeed } from '../../shared/db.ts';
import { isDateKey } from '../../shared/localDate.ts';
import { cleanUsername, COACH_SPEEDS, emptyBaselines, emptyTargets, MAX_RATING, MIN_RATING, parseRatingInput, SPEED_LABEL, suggestTargets, type CoachPlan } from './planLogic.ts';

/** The plan form: what is typed, how suggested targets follow the starting ratings, and how it becomes a plan. No React. */

export type TargetKey = 'three' | 'six';

export interface FormState {
  username: string;
  startDate: string;
  /** Text as typed, '' = none. */
  baselines: Record<CoachSpeed, string>;
  targets: Record<CoachSpeed, Record<TargetKey, string>>;
  /** True once a target was typed by hand: the suggestions then stop following the starting ratings. */
  edited: boolean;
}

const text = (n: number | null) => (n === null ? '' : String(n));

function targetText(baselines: Record<CoachSpeed, string>): FormState['targets'] {
  const base = emptyBaselines();
  for (const s of COACH_SPEEDS) base[s] = parseRatingInput(baselines[s]);
  const t = suggestTargets(base);
  const out = {} as FormState['targets'];
  for (const s of COACH_SPEEDS) out[s] = { three: text(t[s].three), six: text(t[s].six) };
  return out;
}

/** A new form: no ratings yet, today as the start. */
export function blankForm(username: string, today: string): FormState {
  const baselines = { rapid: '', blitz: '', bullet: '', daily: '' };
  return { username, startDate: today, baselines, targets: targetText(baselines), edited: false };
}

/** A form that shows a stored plan. Its targets are the player's own, so they are not recalculated. */
export function formFromPlan(plan: CoachPlan): FormState {
  const baselines = {} as FormState['baselines'];
  const targets = {} as FormState['targets'];
  for (const s of COACH_SPEEDS) {
    baselines[s] = text(plan.baselines[s]);
    targets[s] = { three: text(plan.targets[s].three), six: text(plan.targets[s].six) };
  }
  return { username: plan.username, startDate: plan.startDate, baselines, targets, edited: true };
}

/** Typing in a starting rating box. Suggested targets follow it until one target has been edited. */
export function withBaseline(form: FormState, speed: CoachSpeed, value: string): FormState {
  const baselines = { ...form.baselines, [speed]: value };
  return { ...form, baselines, targets: form.edited ? form.targets : targetText(baselines) };
}

/** Starting ratings fetched from the site: boxes the player already filled stay as they are. */
export function withFetched(form: FormState, ratings: Record<CoachSpeed, number | null>): FormState {
  let next = form;
  for (const s of COACH_SPEEDS) if (!form.baselines[s].trim() && ratings[s] !== null) next = withBaseline(next, s, String(ratings[s]));
  return next;
}

export function withTarget(form: FormState, speed: CoachSpeed, key: TargetKey, value: string): FormState {
  return { ...form, edited: true, targets: { ...form.targets, [speed]: { ...form.targets[speed], [key]: value } } };
}

export type FormResult = { ok: true; plan: CoachPlan } | { ok: false; error: string };

/** The plan a form describes, or what is wrong with it. */
export function planFromForm(form: FormState): FormResult {
  if (!isDateKey(form.startDate)) return { ok: false, error: 'Pick a start date.' };
  const typed = form.username.trim();
  const username = cleanUsername(typed);
  if (typed && !username) return { ok: false, error: 'That does not look like a chess.com username. Use letters, numbers, dashes and underscores, or leave it empty.' };
  const baselines = emptyBaselines();
  const targets = emptyTargets();
  const bad = (what: string) => ({ ok: false as const, error: `${what} must be a whole number from ${MIN_RATING} to ${MAX_RATING}, or empty.` });
  for (const s of COACH_SPEEDS) {
    const b = form.baselines[s].trim();
    baselines[s] = b ? parseRatingInput(b) : null;
    if (b && baselines[s] === null) return bad(`${SPEED_LABEL[s]} starting rating`);
    for (const k of ['three', 'six'] as const) {
      const t = form.targets[s][k].trim();
      const v = t ? parseRatingInput(t) : null;
      if (t && v === null) return bad(`${SPEED_LABEL[s]} ${k === 'three' ? '3 month' : '6 month'} target`);
      targets[s][k] = v;
    }
  }
  return { ok: true, plan: { username, startDate: form.startDate, baselines, targets } };
}
