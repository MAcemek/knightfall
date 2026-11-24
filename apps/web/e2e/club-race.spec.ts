import { test, expect } from './fixtures.ts';
import { clubRace, expectPuzzle, joinClubByLink, lobbyRating, missPuzzle, puzzleAt, solvePuzzle } from './helpers.ts';

test('club race: lobby, same puzzles, live ranking, a late joiner, results and a new race', async ({ open }) => {
  const ana = await open('Ana');
  const ben = await open('Ben');

  // Ana opens a room; Ben joins through the share link. Both see two players, only Ana can start.
  await ana.page.getByRole('button', { name: 'Create room' }).click();
  const code = (await ana.page.getByTestId('club-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  await joinClubByLink(ben, code);
  for (const p of [ana, ben]) await expect(p.page.getByRole('heading', { name: 'Players (2)' })).toBeVisible();
  await expect(ana.page.getByRole('button', { name: 'Start race' })).toBeVisible();
  await expect(ben.page.getByRole('button', { name: 'Start race' })).toHaveCount(0);
  await expect(ben.page.getByText('Waiting for the host to start the race…')).toBeVisible();

  // Ana starts. Both get the same first puzzle: the one the race seed prescribes.
  await ana.page.getByRole('button', { name: 'Start race' }).click();
  await expect(ana.page.getByTestId('my-score')).toBeVisible();
  await expect(ben.page.getByTestId('my-score')).toBeVisible();
  const { seed, settings } = clubRace(ana);
  const puzzles = [0, 1, 2, 3].map((i) => puzzleAt(seed, i, settings.level));
  await expectPuzzle(ana.page, 0, puzzles[0]);
  await expectPuzzle(ben.page, 0, puzzles[0]);

  // Ana solves one. Ben's live ranking shows her on 1.
  await solvePuzzle(ana.page, puzzles[0]);
  const anaRow = ben.page.getByTestId('club-ranking').getByRole('listitem').filter({ hasText: 'Ana' });
  await expect(anaRow.locator(':scope > span').last()).toHaveText('1');

  // Cai arrives mid-race: a spectator until the next one.
  const cai = await open('Cai');
  await joinClubByLink(cai, code);
  await expect(cai.page.getByText('A race is in progress')).toBeVisible();

  // Ana strikes out (locked, the race goes on because Ben still plays), then Ben does: the race is over.
  await expectPuzzle(ana.page, 1, puzzles[1]);
  for (let i = 1; i <= 3; i++) {
    await missPuzzle(ana.page, puzzles[i]);
    if (i < 3) await expectPuzzle(ana.page, i + 1, puzzles[i + 1]);
  }
  await expect(ana.page.getByText('Out of strikes')).toBeVisible();
  await expect(ana.page.getByText('Waiting for the race to finish…')).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await missPuzzle(ben.page, puzzles[i], { ends: i === 2 });
    if (i < 2) await expectPuzzle(ben.page, i + 1, puzzles[i + 1]);
  }
  await expect(ana.page.getByText('You won the race!')).toBeVisible();
  await expect(ben.page.getByText('You finished 2nd')).toBeVisible();
  await expect(cai.page.getByText('Race finished')).toBeVisible();

  // Ana starts a new race: everyone, Cai included, is back in the lobby with three players.
  await ana.page.getByRole('button', { name: 'New race' }).click();
  for (const p of [ana, ben, cai]) {
    await expect(p.page.getByRole('heading', { name: 'Players (3)' })).toBeVisible();
    await expect(p.page.getByTestId('club-code')).toHaveText(code);
  }
  await expect(ana.page.getByRole('button', { name: 'Start race' })).toBeVisible();
  await expect(cai.page.getByRole('button', { name: 'Start race' })).toHaveCount(0);

  // A club race is casual: nobody's battle rating moved.
  for (const p of [ana, ben]) {
    await p.page.getByRole('button', { name: 'Leave room' }).click();
    await expect(lobbyRating(p.page)).toHaveText('1200');
  }
});
