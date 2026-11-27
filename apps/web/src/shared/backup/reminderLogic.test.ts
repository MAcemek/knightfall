import { describe, expect, it } from 'vitest';
import { hasMeaningfulProgress, reminderText, shouldRemindBackup } from './reminderLogic.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 30);
const big = { attempts: 50, battles: 0, coach: false };

describe('backup reminder', () => {
  it('needs meaningful progress', () => {
    expect(hasMeaningfulProgress({ attempts: 19, battles: 0, coach: false })).toBe(false);
    expect(hasMeaningfulProgress({ attempts: 20, battles: 0, coach: false })).toBe(true);
    expect(hasMeaningfulProgress({ attempts: 0, battles: 1, coach: false })).toBe(true);
    expect(hasMeaningfulProgress({ attempts: 0, battles: 0, coach: true })).toBe(true);
  });
  it('stays quiet without progress', () => {
    expect(shouldRemindBackup({ attempts: 3, battles: 0, coach: false }, null, NOW)).toBe(false);
  });
  it('reminds when never backed up', () => {
    expect(shouldRemindBackup(big, null, NOW)).toBe(true);
    expect(shouldRemindBackup(big, 'garbage', NOW)).toBe(true);
  });
  it('reminds only after 14 days', () => {
    expect(shouldRemindBackup(big, new Date(NOW - 13 * DAY).toISOString(), NOW)).toBe(false);
    expect(shouldRemindBackup(big, new Date(NOW - 15 * DAY).toISOString(), NOW)).toBe(true);
  });
  it('words the reminder', () => {
    expect(reminderText(null, NOW)).toContain('never been backed up');
    expect(reminderText(new Date(NOW - 20 * DAY).toISOString(), NOW)).toContain('20 days ago');
  });
});
