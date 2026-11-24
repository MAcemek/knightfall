import { expect, test as base } from '@playwright/test';
import { openPlayer, type Player } from './helpers.ts';

/**
 * `open(name)` starts a player in a fresh browser context (own storage, own friend code). At the end of the
 * test every context is closed, and the test fails if any player's page threw an uncaught exception.
 */
export const test = base.extend<{ open: (name: string) => Promise<Player> }>({
  open: async ({ browser }, use, testInfo) => {
    const players: Player[] = [];
    await use(async (name) => {
      const player = await openPlayer(browser, name);
      players.push(player);
      return player;
    });
    for (const p of players) {
      if (p.consoleErrors.length) testInfo.annotations.push({ type: `console errors (${p.name})`, description: p.consoleErrors.join('\n') });
      await p.context.close().catch(() => {});
    }
    expect(
      players.flatMap((p) => p.pageErrors.map((e) => `${p.name}: ${e}`)),
      'uncaught page errors',
    ).toEqual([]);
  },
});

export { expect };
