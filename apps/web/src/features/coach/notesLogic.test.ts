import { describe, expect, it } from 'vitest';
import { addNote, canAddNote, MAX_DAILY_NOTES, newNoteId, removeNote, sanitizeDailyNotes, updateNote } from './notesLogic.ts';

const seq = () => {
  let i = 0;
  return () => (i++ % 100) / 100;
};

describe('sanitizeDailyNotes', () => {
  it('gives an empty list for junk', () => {
    expect(sanitizeDailyNotes(null)).toEqual([]);
    expect(sanitizeDailyNotes({})).toEqual([]);
    expect(sanitizeDailyNotes([null, 5, 'x', [], {}, { id: '' }])).toEqual([]);
  });
  it('fills missing fields and cuts long text', () => {
    const [n] = sanitizeDailyNotes([{ id: 'a', opponent: 'x'.repeat(60), checks: 'y'.repeat(500), myColor: 'z', done: { checks: 'yes', threats: true } }]);
    expect(n.opponent).toHaveLength(40);
    expect(n.checks).toHaveLength(400);
    expect(n.myColor).toBe('w');
    expect(n.done).toEqual({ checks: false, captures: false, threats: true });
    expect(n.plan).toBe('');
    expect(n.updatedAt).toBe(0);
  });
  it('keeps one note per id and at most 10', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ id: `n${i}`, myColor: 'b' }));
    expect(sanitizeDailyNotes(rows)).toHaveLength(10);
    expect(sanitizeDailyNotes([{ id: 'a', opponent: 'first' }, { id: 'a', opponent: 'second' }])).toHaveLength(1);
    expect(sanitizeDailyNotes([{ id: 'a', opponent: 'first' }, { id: 'a', opponent: 'second' }])[0].opponent).toBe('first');
    expect(sanitizeDailyNotes([{ id: 'a', myColor: 'b' }])[0].myColor).toBe('b');
  });
});

describe('add, update, remove', () => {
  it('adds an empty note on top with a fresh id', () => {
    const rand = seq();
    const one = addNote([], 1000, rand);
    const two = addNote(one, 2000, rand);
    expect(two).toHaveLength(2);
    expect(two[1]).toEqual(one[0]);
    expect(two[0].id).not.toBe(two[1].id);
    expect(two[0]).toMatchObject({ opponent: '', myColor: 'w', updatedAt: 2000, done: { checks: false, captures: false, threats: false } });
  });
  it('stops at 10 notes', () => {
    let list = sanitizeDailyNotes([]);
    const rand = seq();
    for (let i = 0; i < 12; i++) list = addNote(list, i, rand);
    expect(list).toHaveLength(MAX_DAILY_NOTES);
    expect(canAddNote(list)).toBe(false);
    expect(canAddNote(list.slice(1))).toBe(true);
    expect(addNote(list, 99, rand)).toEqual(list);
  });
  it('ids differ for the same time with different random numbers', () => {
    expect(newNoteId(5, () => 0.1)).not.toBe(newNoteId(5, () => 0.2));
  });
  it('updates one note and cuts text', () => {
    const [a] = addNote([], 1, () => 0.5);
    const [b] = addNote([a], 2, () => 0.7);
    const out = updateNote([b, a], a.id, { opponent: 'z'.repeat(80), plan: 'p'.repeat(500), myColor: 'b', done: { threats: true } }, 9);
    expect(out[0]).toEqual(b);
    expect(out[1].opponent).toHaveLength(40);
    expect(out[1].plan).toHaveLength(400);
    expect(out[1]).toMatchObject({ myColor: 'b', updatedAt: 9, done: { checks: false, captures: false, threats: true } });
    expect(updateNote([b, a], 'missing', { plan: 'x' }, 9)).toEqual([b, a]);
  });
  it('keeps typed spaces', () => {
    const [a] = addNote([], 1, () => 0.5);
    expect(updateNote([a], a.id, { checks: 'a ' }, 2)[0].checks).toBe('a ');
  });
  it('removes by id', () => {
    const [a] = addNote([], 1, () => 0.5);
    const [b] = addNote([a], 2, () => 0.7);
    expect(removeNote([b, a], a.id)).toEqual([b]);
    expect(removeNote([b, a], 'missing')).toEqual([b, a]);
  });
});
