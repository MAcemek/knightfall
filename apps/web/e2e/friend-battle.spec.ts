import { test, expect } from './fixtures.ts';
import {
  backToLobby, chooseFriendSettings, countdown, expectPlaying, expectPuzzle, friendCode, invitation, lobbyRating, mark, missPuzzle, pillText,
  puzzleAt, sendChallenge, solvePuzzle, waitForMessage,
} from './helpers.ts';

test('friend battle: challenge, settings, same puzzles, a real win, a casual result', async ({ open }) => {
  const ana = await open('Ana');
  const ben = await open('Ben');
  const anaCode = await friendCode(ana);
  const benCode = await friendCode(ben);

  // Ben picks 1 min and Harder, types Ana's code and challenges her.
  await chooseFriendSettings(ben.page, { time: '1 min', level: 'Harder' });
  const anaSince = mark(ana);
  const benSince = mark(ben);
  await sendChallenge(ben.page, anaCode);

  // Ana's invitation names Ben and the settings he chose.
  const invite = invitation(ana.page);
  await expect(invite).toContainText('Ben');
  await expect(invite).toContainText('Casual');
  await expect(invite).toContainText('1 min · Harder');
  await invite.getByRole('button', { name: 'Accept' }).click();

  const matchedAna = await waitForMessage(ana, 'matched', { since: anaSince });
  const matchedBen = await waitForMessage(ben, 'matched', { since: benSince });
  expect(matchedAna.seed).toBe(matchedBen.seed);
  expect(matchedAna.friendly).toBe(true);
  expect(matchedAna.settings).toEqual({ durationMs: 60_000, level: 'harder' });
  expect(matchedAna.opponent.name).toBe('Ben');
  expect(matchedBen.opponent.name).toBe('Ana');
  expect(matchedAna.opponentCode).toBe(benCode.replace('-', ''));
  const { seed } = matchedAna;
  const level = 'harder';

  // Both leave the countdown and face the very same first puzzle: the one the seed prescribes.
  await expect(countdown(ana.page)).toContainText('Same puzzles. One minute.');
  await expectPlaying(ana, ben);
  const puzzles = [0, 1, 2].map((i) => puzzleAt(seed, i, level));
  await expectPuzzle(ana.page, 0, puzzles[0]);
  await expectPuzzle(ben.page, 0, puzzles[0]);
  expect(await pillText(ana.page)).toBe(await pillText(ben.page));

  // Ana solves two puzzles for real. Her score is 2, and so is the opponent score on Ben's screen.
  await solvePuzzle(ana.page, puzzles[0]);
  await expectPuzzle(ana.page, 1, puzzles[1]);
  await solvePuzzle(ana.page, puzzles[1]);
  await expect(ben.page.getByTestId('opp-score')).toHaveText('2');
  await expect(ana.page.getByTestId('my-score')).toHaveText('2');

  // Ben misses three. He is out while Ana is ahead, so the server ends the battle on the spot.
  for (let i = 0; i < 3; i++) {
    await missPuzzle(ben.page, puzzles[i], { ends: i === 2 });
    if (i < 2) await expectPuzzle(ben.page, i + 1, puzzles[i + 1]);
  }

  await expect(ana.page.getByText('Victory!')).toBeVisible();
  await expect(ben.page.getByText('Defeat')).toBeVisible();
  await expect(ana.page.getByText('Your opponent struck out')).toBeVisible();
  await expect(ben.page.getByText('You struck out')).toBeVisible();
  await expect(ana.page.getByTestId('end-you-score')).toHaveText('2');
  await expect(ana.page.getByTestId('end-opp-score')).toHaveText('0');
  await expect(ben.page.getByTestId('end-you-score')).toHaveText('0');
  await expect(ben.page.getByTestId('end-opp-score')).toHaveText('2');
  for (const p of [ana, ben]) {
    await expect(p.page.getByText('Casual', { exact: true })).toBeVisible();
    await expect(p.page.getByText('Friend battle. Your battle rating is unchanged.')).toBeVisible();
  }

  // Back in the lobby: rating untouched, and each is in the other's Recent opponents with the right record.
  await backToLobby(ana.page);
  await backToLobby(ben.page);
  await expect(lobbyRating(ana.page)).toHaveText('1200');
  await expect(lobbyRating(ben.page)).toHaveText('1200');
  await expect(ana.page.getByRole('listitem').filter({ hasText: 'Ben' }).filter({ hasText: 'Challenge' })).toContainText('1W-0L-0D');
  await expect(ben.page.getByRole('listitem').filter({ hasText: 'Ana' }).filter({ hasText: 'Challenge' })).toContainText('0W-1L-0D');
});

test('best of 3: the series score is kept and the next game starts by itself with a new seed', async ({ open }) => {
  const ana = await open('Ana');
  const ben = await open('Ben');
  const anaCode = await friendCode(ana);

  await chooseFriendSettings(ben.page, { time: '1 min', series: 'Best of 3' });
  const anaSince = mark(ana);
  const benSince = mark(ben);
  await sendChallenge(ben.page, anaCode);
  const invite = invitation(ana.page);
  await expect(invite).toContainText('1 min · Normal · Best of 3');
  await invite.getByRole('button', { name: 'Accept' }).click();

  const game1 = await waitForMessage(ana, 'matched', { since: anaSince });
  await waitForMessage(ben, 'matched', { since: benSince });
  expect(game1.series).toEqual({ length: 3, game: 1, me: 0, opp: 0 });
  await expect(countdown(ana.page)).toContainText('Game 1 of 3');
  await expectPlaying(ana, ben);

  // Game 1: Ana solves one, Ben strikes out.
  const first = [0, 1, 2].map((i) => puzzleAt(game1.seed, i, 'normal'));
  await expectPuzzle(ana.page, 0, first[0]);
  await solvePuzzle(ana.page, first[0]);
  for (let i = 0; i < 3; i++) {
    await missPuzzle(ben.page, first[i], { ends: i === 2 });
    if (i < 2) await expectPuzzle(ben.page, i + 1, first[i + 1]);
  }
  await expect(ana.page.getByText('Victory!')).toBeVisible();
  await expect(ben.page.getByText('Defeat')).toBeVisible();
  await expect(ana.page.getByTestId('series-line')).toHaveText(/^Game 1 of 3 · You lead 1–0 · next game in \d+…$/);
  await expect(ben.page.getByTestId('series-line')).toHaveText(/^Game 1 of 3 · Opponent leads 0–1 · next game in \d+…$/);

  // The server starts game 2 without anyone pressing anything, with a new seed and the running score.
  const anaAfterGame1 = mark(ana);
  const benAfterGame1 = mark(ben);
  const game2 = await waitForMessage(ana, 'matched', { since: anaAfterGame1, timeout: 20_000 });
  const game2Ben = await waitForMessage(ben, 'matched', { since: benAfterGame1 });
  expect(game2.seed).not.toBe(game1.seed);
  expect(game2.seed).toBe(game2Ben.seed);
  expect(game2.series).toEqual({ length: 3, game: 2, me: 1, opp: 0 });
  expect(game2Ben.series).toEqual({ length: 3, game: 2, me: 0, opp: 1 });
  await expect(countdown(ana.page)).toContainText('Game 2 of 3');
  await expectPlaying(ana, ben);
  const second = puzzleAt(game2.seed, 0, 'normal');
  await expectPuzzle(ana.page, 0, second);
  await expectPuzzle(ben.page, 0, second);

  // Resigning ends the whole series (the resign prompt says so), whatever the score.
  await ben.page.getByRole('button', { name: 'Resign' }).click();
  await expect(ben.page.getByText('this ends the whole series')).toBeVisible();
  await ben.page.getByRole('button', { name: 'Resign', exact: true }).last().click();
  await expect(ben.page.getByText('Defeat')).toBeVisible();
  await expect(ben.page.getByTestId('series-line')).toHaveText('You left the series at 0–2');
  await expect(ana.page.getByText('Victory!')).toBeVisible();
  await expect(ana.page.getByText('Your opponent left the battle')).toBeVisible();
  await expect(ana.page.getByTestId('series-line')).toHaveText('Your opponent left · series ended 2–0');

  // And no third game follows: wait out the pause the server uses between games.
  const anaEnd = mark(ana);
  await ana.page.waitForTimeout(7_500);
  expect(ana.received.slice(anaEnd).filter((m) => m.type === 'matched')).toEqual([]);
  await expect(countdown(ana.page)).toBeHidden();
});

test('a declined challenge says so, and an opponent who leaves mid-game hands you the win', async ({ open }) => {
  const ana = await open('Ana');
  const ben = await open('Ben');
  const anaCode = await friendCode(ana);

  await sendChallenge(ben.page, anaCode);
  await invitation(ana.page).getByRole('button', { name: 'Decline' }).click();
  await expect(ben.page.getByRole('alert')).toContainText('Ana declined your challenge.');
  await expect(invitation(ana.page)).toBeHidden();

  // A second try goes through. Ben's browser then disappears in the middle of the battle.
  const anaSince = mark(ana);
  await sendChallenge(ben.page, anaCode);
  await invitation(ana.page).getByRole('button', { name: 'Accept' }).click();
  const matched = await waitForMessage(ana, 'matched', { since: anaSince });
  await expectPlaying(ana, ben);
  await expectPuzzle(ana.page, 0, puzzleAt(matched.seed, 0, 'normal'));

  await ben.context.close();
  await expect(ana.page.getByText('Your opponent left the battle')).toBeVisible();
  await expect(ana.page.getByText('Victory!')).toBeVisible();
  await expect(ana.page.getByText('Friend battle. Your battle rating is unchanged.')).toBeVisible();
  await backToLobby(ana.page);
  await expect(lobbyRating(ana.page)).toHaveText('1200');
});
