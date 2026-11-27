import { test, expect } from './fixtures.ts';
import {
  blip, expectPlaying, expectPuzzle, friendCode, invitation, mark, missPuzzle, puzzleAt, sendChallenge, solvePuzzle, waitForMessage,
} from './helpers.ts';

test('reconnect: a short connection drop mid-battle does not forfeit, and the score made offline still counts', async ({ open }) => {
  const ana = await open('Ana');
  const ben = await open('Ben');
  const anaCode = await friendCode(ana);

  const anaSince = mark(ana);
  await sendChallenge(ben.page, anaCode);
  await invitation(ana.page).getByRole('button', { name: 'Accept' }).click();
  const matched = await waitForMessage(ana, 'matched', { since: anaSince });
  const puzzles = [0, 1, 2, 3].map((i) => puzzleAt(matched.seed, i));
  await expectPlaying(ana, ben);
  await expectPuzzle(ana.page, 0, puzzles[0]);

  await solvePuzzle(ana.page, puzzles[0]);
  await expect(ben.page.getByTestId('opp-score')).toHaveText('1');

  // Ana's connection drops for about three seconds. Ben is told, and keeps playing; Ana solves a puzzle meanwhile.
  const benSince = mark(ben);
  const anaBefore = mark(ana);
  await blip(ana, 3000, async () => {
    await expect(ben.page.getByTestId('connection-banner')).toContainText('lost their connection');
    await expect(ana.page.getByTestId('connection-banner')).toContainText('Reconnecting');
    await expectPuzzle(ana.page, 1, puzzles[1]);
    await solvePuzzle(ana.page, puzzles[1]);
  });
  await waitForMessage(ben, 'opponent-away', { since: benSince });

  // Back within the grace: same room, both sides carry on, and the puzzle solved offline reaches Ben.
  const resumed = await waitForMessage(ana, 'matched', { since: anaBefore, where: (m) => m.resume !== undefined, timeout: 20_000 });
  expect(resumed.roomId).toBe(matched.roomId);
  expect(resumed.seed).toBe(matched.seed);
  await expect(ana.page.getByTestId('connection-banner')).toBeHidden({ timeout: 20_000 });
  await expect(ben.page.getByTestId('connection-banner')).toBeHidden({ timeout: 20_000 });
  await expect(ben.page.getByTestId('opp-score')).toHaveText('2', { timeout: 20_000 });
  await expect(ana.page.getByText('Victory!')).toBeHidden();
  await expect(ben.page.getByText('Victory!')).toBeHidden();
  await expect(ben.page.getByText('Defeat')).toBeHidden();

  // The battle really goes on: Ana scores again, then Ben strikes out and the battle ends normally.
  await expectPuzzle(ana.page, 2, puzzles[2]);
  await solvePuzzle(ana.page, puzzles[2]);
  await expect(ben.page.getByTestId('opp-score')).toHaveText('3');
  for (let i = 0; i < 3; i++) {
    await missPuzzle(ben.page, puzzles[i], { ends: i === 2 });
    if (i < 2) await expectPuzzle(ben.page, i + 1, puzzles[i + 1]);
  }
  await expect(ana.page.getByText('Victory!')).toBeVisible();
  await expect(ben.page.getByText('Defeat')).toBeVisible();
  await expect(ana.page.getByTestId('end-you-score')).toHaveText('3');
});
