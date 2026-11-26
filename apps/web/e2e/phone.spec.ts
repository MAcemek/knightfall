import { test, expect } from './fixtures.ts';
import {
  backToLobby, chooseFriendSettings, clubRace, countdown, expectPlaying, expectPuzzle, friendCode, invitation, joinClubByLink, mark, missPuzzle,
  pill, puzzleAt, sendChallenge, solvePuzzle, waitForMessage,
} from './helpers.ts';
import { checkStage } from './layout.ts';

/**
 * Two phones (375x667 and, as `phone-small`, 360x640; touch) play a friend battle and a club race. At every stage the layout is measured
 * with real bounding boxes and a screenshot goes to apps/web/test-results/<project>/<stage>.png.
 * All layout checks are soft: a wrong stage is reported and the run carries on to the next one.
 */
test.setTimeout(180_000);

test('phones: a friend battle, stage by stage', async ({ open }) => {
  const ana = await open('Ana');
  // A 20-character name (the longest allowed): the Recent opponents row on Ana's lobby must truncate it, not widen the page.
  const ben = await open('Bartholomew Wellings');
  const anaCode = await friendCode(ana);

  await checkStage(ana, 'lobby');
  await checkStage(ben, 'lobby', { shot: false });

  await chooseFriendSettings(ben.page, { time: '1 min' });
  const anaSince = mark(ana);
  const benSince = mark(ben);
  await sendChallenge(ben.page, anaCode);

  await expect(invitation(ana.page)).toBeVisible();
  await expect(invitation(ana.page).getByRole('button', { name: 'Accept' })).toBeVisible();
  await checkStage(ana, 'invitation');
  await invitation(ana.page).getByRole('button', { name: 'Accept' }).click();

  const matched = await waitForMessage(ana, 'matched', { since: anaSince });
  await waitForMessage(ben, 'matched', { since: benSince });
  const level = matched.settings?.level;
  const puzzles = [0, 1, 2, 3].map((i) => puzzleAt(matched.seed, i, level));

  await expect(countdown(ana.page)).toBeVisible();
  // The two cards slide in from the sides: the check waits for them to settle.
  await checkStage(ana, 'countdown', { settle: true });

  await expectPlaying(ana, ben);
  await expect(pill(ana.page)).toBeVisible();
  await checkStage(ana, 'play-start', { play: 'start' });
  await checkStage(ben, 'play-start', { play: 'start', shot: false });

  // Ana solves one: 1-0.
  await expectPuzzle(ana.page, 0, puzzles[0]);
  await solvePuzzle(ana.page, puzzles[0]);
  await expect(ben.page.getByTestId('opp-score')).toHaveText('1');
  await checkStage(ana, 'play-after-solve', { play: 'later' });

  // Ben solves one too (1-1), then strikes out. He is not behind, so the battle goes on and he is locked out.
  await expectPuzzle(ben.page, 0, puzzles[0]);
  await solvePuzzle(ben.page, puzzles[0]);
  for (let i = 1; i <= 3; i++) {
    await expectPuzzle(ben.page, i, puzzles[i]);
    await missPuzzle(ben.page, puzzles[i]);
  }
  await expect(ben.page.getByText('Out of strikes')).toBeVisible();
  await checkStage(ben, 'out-of-strikes', { play: 'later' });

  // Ana is told Ben is out and what she needs to clinch the win.
  await expect(ana.page.getByText('is out of lives')).toBeVisible();
  await checkStage(ana, 'opponent-out', { play: 'later' });

  // Ana's second solve puts her ahead of the struck-out Ben: the battle ends.
  await expectPuzzle(ana.page, 1, puzzles[1]);
  await solvePuzzle(ana.page, puzzles[1], { ends: true });
  await expect(ana.page.getByText('Victory!')).toBeVisible();
  await expect(ben.page.getByText('Defeat')).toBeVisible();
  await expect(ana.page.getByTestId('end-you-score')).toHaveText('2');
  await checkStage(ana, 'end-screen', { atTop: true });
  await checkStage(ben, 'end-screen', { shot: false, atTop: true });

  await backToLobby(ana.page);
  await backToLobby(ben.page);

  // Back in the lobby with the other player listed under Recent opponents: nothing may push the page wider than the screen.
  for (const [p, other] of [[ana, 'Bartholomew'], [ben, 'Ana']] as const) {
    await expect(p.page.getByRole('listitem').filter({ hasText: other }).filter({ hasText: 'Challenge' })).toBeVisible();
    await checkStage(p, 'lobby-recent-opponents', { shot: p === ana });
  }

  // ---- club race on the same two phones ----
  await ana.page.getByRole('button', { name: 'Create room' }).click();
  const code = (await ana.page.getByTestId('club-code').innerText()).trim();
  await joinClubByLink(ben, code);
  for (const p of [ana, ben]) await expect(p.page.getByRole('heading', { name: 'Players (2)' })).toBeVisible();
  await checkStage(ana, 'club-lobby');
  await checkStage(ben, 'club-lobby', { shot: false });

  await ana.page.getByRole('button', { name: 'Start race' }).click();
  await expect(ana.page.getByTestId('my-score')).toBeVisible();
  await expect(ben.page.getByTestId('my-score')).toBeVisible();
  const race = clubRace(ana);
  const raceSet = [0, 1, 2, 3].map((i) => puzzleAt(race.seed, i, race.settings.level));
  await expectPuzzle(ana.page, 0, raceSet[0]);
  await expectPuzzle(ben.page, 0, raceSet[0]);
  await checkStage(ana, 'club-race', { play: 'start' });
  await checkStage(ben, 'club-race', { play: 'start', shot: false });

  // Ana solves one; Ben strikes out; then Ana strikes out too: the race is over and Ana won it.
  await solvePuzzle(ana.page, raceSet[0]);
  for (let i = 0; i < 3; i++) {
    await missPuzzle(ben.page, raceSet[i]);
    if (i < 2) await expectPuzzle(ben.page, i + 1, raceSet[i + 1]);
  }
  await expect(ben.page.getByText('Out of strikes')).toBeVisible();
  await expectPuzzle(ana.page, 1, raceSet[1]);
  for (let i = 1; i <= 3; i++) {
    await missPuzzle(ana.page, raceSet[i], { ends: i === 3 });
    if (i < 3) await expectPuzzle(ana.page, i + 1, raceSet[i + 1]);
  }
  await expect(ana.page.getByText('You won the race!')).toBeVisible();
  await expect(ben.page.getByText('You finished 2nd')).toBeVisible();
  await checkStage(ana, 'club-results', { atTop: true });
  await checkStage(ben, 'club-results', { shot: false, atTop: true });
});
