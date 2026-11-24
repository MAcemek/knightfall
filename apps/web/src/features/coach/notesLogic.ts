/** Notes on Daily games in progress: a short checklist per game. Pure rules; storage is in notesStore.ts. */

export const MAX_DAILY_NOTES = 10;
export const MAX_OPPONENT = 40;
export const MAX_TEXT = 400;

export interface DailyNote {
  id: string;
  opponent: string;
  myColor: 'w' | 'b';
  /** What you found when you looked for checks, captures and threats, in your own words. */
  checks: string;
  captures: string;
  threats: string;
  candidates: string;
  plan: string;
  /** Which of the three looks were done on this move. */
  done: { checks: boolean; captures: boolean; threats: boolean };
  updatedAt: number;
}

export type NoteText = 'opponent' | 'checks' | 'captures' | 'threats' | 'candidates' | 'plan';
export type NoteLook = 'checks' | 'captures' | 'threats';

export const NOTE_TEXT_FIELDS: readonly NoteText[] = ['opponent', 'checks', 'captures', 'threats', 'candidates', 'plan'];

const limitOf = (field: NoteText) => (field === 'opponent' ? MAX_OPPONENT : MAX_TEXT);

/** Text as typed, cut to its limit. Spaces are kept so typing is not interrupted. */
export function clip(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.slice(0, max) : '';
}

function cleanNote(raw: unknown): DailyNote | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 40) return null;
  const done = typeof r.done === 'object' && r.done !== null ? (r.done as Record<string, unknown>) : {};
  return {
    id: r.id,
    opponent: clip(r.opponent, MAX_OPPONENT),
    myColor: r.myColor === 'b' ? 'b' : 'w',
    checks: clip(r.checks, MAX_TEXT),
    captures: clip(r.captures, MAX_TEXT),
    threats: clip(r.threats, MAX_TEXT),
    candidates: clip(r.candidates, MAX_TEXT),
    plan: clip(r.plan, MAX_TEXT),
    done: { checks: done.checks === true, captures: done.captures === true, threats: done.threats === true },
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  };
}

/** The stored notes, cleaned: at most 10, one per id, in stored order. */
export function sanitizeDailyNotes(raw: unknown): DailyNote[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DailyNote[] = [];
  for (const item of raw) {
    const n = cleanNote(item);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    if (out.length >= MAX_DAILY_NOTES) break;
  }
  return out;
}

export function canAddNote(notes: readonly DailyNote[]): boolean {
  return notes.length < MAX_DAILY_NOTES;
}

export function newNoteId(now: number, rand: () => number = Math.random): string {
  return `n${now.toString(36)}${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

/** A new empty note at the top of the list. The list comes back unchanged when it already holds 10. */
export function addNote(notes: readonly DailyNote[], now: number, rand: () => number = Math.random): DailyNote[] {
  const clean = sanitizeDailyNotes(notes);
  if (!canAddNote(clean)) return clean;
  const note: DailyNote = {
    id: newNoteId(now, rand),
    opponent: '',
    myColor: 'w',
    checks: '',
    captures: '',
    threats: '',
    candidates: '',
    plan: '',
    done: { checks: false, captures: false, threats: false },
    updatedAt: now,
  };
  return [note, ...clean];
}

export type NotePatch = Partial<Pick<DailyNote, NoteText | 'myColor'>> & { done?: Partial<DailyNote['done']> };

/** One note changed. Text is cut to its limit. An unknown id changes nothing. */
export function updateNote(notes: readonly DailyNote[], id: string, patch: NotePatch, now: number): DailyNote[] {
  return sanitizeDailyNotes(notes).map((n) => {
    if (n.id !== id) return n;
    const next: DailyNote = { ...n, done: { ...n.done }, updatedAt: now };
    for (const f of NOTE_TEXT_FIELDS) if (typeof patch[f] === 'string') next[f] = clip(patch[f], limitOf(f));
    if (patch.myColor === 'w' || patch.myColor === 'b') next.myColor = patch.myColor;
    if (patch.done) for (const k of ['checks', 'captures', 'threats'] as const) if (typeof patch.done[k] === 'boolean') next.done[k] = patch.done[k];
    return next;
  });
}

/** The list without the note. */
export function removeNote(notes: readonly DailyNote[], id: string): DailyNote[] {
  return sanitizeDailyNotes(notes).filter((n) => n.id !== id);
}
