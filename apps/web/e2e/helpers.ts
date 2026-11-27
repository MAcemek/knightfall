import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import {
  BUCKET_SIZE, bucketFileName, bucketFor, decode, MAX_BUCKET, MIN_BUCKET, pickIndex, rampFor, rampRating, rowToPuzzle, uciToMove,
  type BattleLevel, type BattleSettings, type Puzzle, type PuzzleRow, type ServerMessage,
} from '@knightfall/core';

/* ------------------------------------------------------------------------------------------------------------- */
/* Players: one browser context each, with its own storage (so its own friend code and name).                    */
/* ------------------------------------------------------------------------------------------------------------- */

export type Msg<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Every server message this player's page received over a WebSocket, in order. */
  received: ServerMessage[];
  /** Uncaught exceptions in the page. Any of these fails the test. */
  pageErrors: string[];
  /** console.error output (kept for the report, does not fail the test: browsers log failed loads there too). */
  consoleErrors: string[];
}

const CODE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

/**
 * A new player: own context, name set through the Settings page, then the Battle page with the friend code showing.
 * The WebSocket listener is registered before the first navigation so no frame is missed.
 */
export async function openPlayer(browser: Browser, name: string, options: BrowserContextOptions = {}): Promise<Player> {
  const context = await browser.newContext({ serviceWorkers: 'block', ...options });
  // Remember every WebSocket the page opens, so a test can drop the connection the way a flaky network does.
  await context.addInitScript(() => {
    const w = window as unknown as { __kfSockets: WebSocket[] };
    w.__kfSockets = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        w.__kfSockets.push(this);
      }
    };
  });
  const page = await context.newPage();
  const player: Player = { name, context, page, received: [], pageErrors: [], consoleErrors: [] };

  page.on('pageerror', (e) => player.pageErrors.push(e.stack ?? e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') player.consoleErrors.push(m.text());
  });
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      const msg = decode<ServerMessage>(typeof payload === 'string' ? payload : payload.toString());
      if (msg) player.received.push(msg);
    });
  });

  await page.goto('/settings');
  const input = page.getByLabel('Player name');
  await expect(input).not.toHaveValue(''); // the generated name has loaded
  await input.fill(name);
  await input.press('Enter');
  await expect(page.getByText('Name saved')).toBeVisible();
  // A fresh load: the socket then says hello with the new name.
  await page.goto('/battle');
  await expect(page.getByTestId('my-code')).toHaveText(CODE);
  return player;
}

/**
 * Cut the player's connection like a wifi blip: the page's sockets are closed and the browser stays offline for
 * `offlineMs`, so the app's reconnect attempts fail until the network is back. Resolves when it is back.
 * `whileOffline` runs in between (the player keeps solving puzzles).
 */
export async function blip(p: Player, offlineMs: number, whileOffline?: () => Promise<void>): Promise<void> {
  await p.page.evaluate(() => (window as unknown as { __kfSockets: WebSocket[] }).__kfSockets.forEach((s) => s.close()));
  await p.context.setOffline(true);
  const started = Date.now();
  await whileOffline?.();
  await p.page.waitForTimeout(Math.max(0, offlineMs - (Date.now() - started)));
  await p.context.setOffline(false);
}

export async function friendCode(p: Player): Promise<string> {
  return (await p.page.getByTestId('my-code').innerText()).trim();
}

/** Index to pass as `since` so only messages received from now on count. */
export const mark = (p: Player): number => p.received.length;

/** Wait for a server message of `type` (after `since`) and return it. */
export async function waitForMessage<T extends ServerMessage['type']>(
  p: Player,
  type: T,
  opts: { since?: number; where?: (m: Msg<T>) => boolean; timeout?: number } = {},
): Promise<Msg<T>> {
  const find = () => p.received.slice(opts.since ?? 0).find((m): m is Msg<T> => m.type === type && (!opts.where || opts.where(m as Msg<T>)));
  await expect.poll(() => find() !== undefined, { timeout: opts.timeout ?? 20_000, message: `${p.name}: waiting for a "${type}" message` }).toBe(true);
  return find()!;
}

/** The newest `club-state` that carries a race seed. */
export function clubRace(p: Player): { seed: number; settings: BattleSettings } {
  const s = [...p.received].reverse().find((m): m is Msg<'club-state'> => m.type === 'club-state' && m.seed !== undefined);
  if (!s) throw new Error(`${p.name} has not received a club race seed`);
  return { seed: s.seed!, settings: s.settings };
}

/* ------------------------------------------------------------------------------------------------------------- */
/* The puzzle sequence, reproduced in Node from the core helpers and the bundled puzzle files.                    */
/* ------------------------------------------------------------------------------------------------------------- */

const PUZZLE_DIR = fileURLToPath(new URL('../public/puzzles/', import.meta.url));
const buckets = new Map<string, Puzzle[]>();

function loadBucket(bucket: number): Puzzle[] {
  const file = bucketFileName(bucket);
  let list = buckets.get(file);
  if (!list) {
    list = (JSON.parse(readFileSync(PUZZLE_DIR + file, 'utf8')) as PuzzleRow[]).map(rowToPuzzle);
    buckets.set(file, list);
  }
  return list;
}

/** Nearest non-empty bucket to `rating`, searching outward like the app does (high buckets can be sparse). */
function nonEmptyBucket(rating: number): Puzzle[] {
  const start = bucketFor(rating);
  for (let d = 0; d <= (MAX_BUCKET - MIN_BUCKET) / BUCKET_SIZE; d++) {
    for (const b of d === 0 ? [start] : [start - d * BUCKET_SIZE, start + d * BUCKET_SIZE]) {
      if (b < MIN_BUCKET || b > MAX_BUCKET) continue;
      const list = loadBucket(b);
      if (list.length) return list;
    }
  }
  throw new Error('No puzzles in the bundled set');
}

/** The index-th puzzle of the race with this seed and difficulty (what both players must see). */
export function puzzleAt(seed: number, index: number, level?: BattleLevel): Puzzle {
  const ramp = rampFor(level);
  const list = nonEmptyBucket(rampRating(index, ramp.start, ramp.step));
  return list[pickIndex(seed, index, list.length)];
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Playing                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------- */

/** The puzzle pill ("#1 · 553"): the page has one per layout, only one is visible. */
export const pill = (page: Page): Locator => page.getByText(/^#\d+ · \d+$/).filter({ visible: true });

/** Wait until the pill shows this puzzle (its number and its rating). */
export async function expectPuzzle(page: Page, index: number, puzzle: Puzzle, timeout = 20_000): Promise<void> {
  await expect(pill(page)).toHaveText(`#${index + 1} · ${puzzle.rating}`, { timeout });
}

const square = (page: Page, sq: string): Locator => page.locator(`[data-square="${sq}"]`);

/** The pieces on the board as the page shows them, as a FEN placement field ('' when there is no board). */
async function readPlacement(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a1 = document.querySelector('[data-square="a1"]')?.getBoundingClientRect();
    const h1 = document.querySelector('[data-square="h1"]')?.getBoundingClientRect();
    if (!a1 || !h1) return '';
    const white = a1.left < h1.left;
    const grid: string[][] = Array.from({ length: 8 }, () => Array<string>(8).fill(''));
    for (const el of document.querySelectorAll<HTMLElement>('.kf-piece')) {
      const m = /translate\(\s*(-?[\d.]+)%\s*,\s*(-?[\d.]+)%\s*\)/.exec(el.style.transform);
      const alt = el.querySelector('img')?.getAttribute('alt');
      if (!m || !alt) continue;
      const col = Math.round(Number(m[1]) / 100);
      const row = Math.round(Number(m[2]) / 100);
      const file = white ? col : 7 - col;
      const rankFromTop = white ? row : 7 - row;
      if (file < 0 || file > 7 || rankFromTop < 0 || rankFromTop > 7) continue;
      grid[rankFromTop][file] = alt[0] === 'w' ? alt[1].toUpperCase() : alt[1].toLowerCase();
    }
    return grid
      .map((r) => {
        let out = '';
        let empty = 0;
        for (const c of r) {
          if (!c) empty++;
          else {
            if (empty) out += empty;
            empty = 0;
            out += c;
          }
        }
        return out + (empty || '');
      })
      .join('/');
  });
}

const placement = (chess: Chess): string => chess.fen().split(' ')[0];

async function waitForPlacement(page: Page, chess: Chess, what: string): Promise<void> {
  await expect
    .poll(() => readPlacement(page), { timeout: 20_000, message: `waiting for the board to show ${what} (${chess.fen()})` })
    .toBe(placement(chess));
}

/** The position the solver faces: the puzzle FEN after the opponent's setup move. */
function afterSetup(puzzle: Puzzle): Chess {
  const chess = new Chess(puzzle.fen);
  chess.move(uciToMove(puzzle.moves[0]));
  return chess;
}

/**
 * Scroll the page (only if needed) so the whole board sits between the sticky header and the bottom nav, like a
 * player would. Playwright's own click-scrolling is avoided on purpose: it scrolls every ancestor, including the
 * board's overflow-hidden container, which shifts the squares under the app's pointer maths.
 */
async function bringBoardIntoView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rect = (s: string) => document.querySelector(`[data-square="${s}"]`)?.getBoundingClientRect();
    const a8 = rect('a8');
    const h1 = rect('h1');
    if (!a8 || !h1) return;
    const top = Math.min(a8.top, h1.top);
    const bottom = Math.max(a8.bottom, h1.bottom);
    const shown = (el: Element | null) => (el && getComputedStyle(el).display !== 'none' ? el : null);
    const nav = [...document.querySelectorAll('nav')].find((n) => getComputedStyle(n).position === 'fixed' && shown(n));
    const header = shown(document.querySelector('header'));
    const lower = nav ? nav.getBoundingClientRect().top : innerHeight;
    const upper = header && getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().bottom : 0;
    if (bottom > lower) window.scrollBy({ top: bottom - lower + 2, behavior: 'instant' });
    else if (top < upper) window.scrollBy({ top: top - upper - 2, behavior: 'instant' });
  });
}

/** Press and release the mouse in the middle of a square, at its position right now. */
async function tapSquare(page: Page, sq: string): Promise<void> {
  const box = await square(page, sq).boundingBox();
  if (!box) throw new Error(`Square ${sq} is not on the page`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function clickMove(page: Page, uci: string): Promise<void> {
  await bringBoardIntoView(page);
  await tapSquare(page, uci.slice(0, 2));
  await tapSquare(page, uci.slice(2, 4));
  if (uci.length > 4) await page.locator(`button:has(img[alt="${uci[4]}"])`).click();
}

/** My score and strikes, read from the HUD. */
export async function myScore(page: Page): Promise<number> {
  return Number((await page.getByTestId('my-score').innerText()).trim());
}
export async function myStrikes(page: Page): Promise<number> {
  const label = (await page.getByTestId('my-strikes').getAttribute('aria-label')) ?? '';
  return Number(/^(\d+)/.exec(label)?.[1] ?? NaN);
}

/**
 * Solve the puzzle on the page by clicking its solution (from-square, then to-square) and wait until the
 * score has gone up by one. The page's replies are observed on the board itself, never waited out blindly.
 * With `ends` the solve ends the battle (the HUD is replaced by the end screen), so the caller checks that instead.
 */
export async function solvePuzzle(page: Page, puzzle: Puzzle, opts: { ends?: boolean } = {}): Promise<void> {
  const before = await myScore(page);
  const chess = afterSetup(puzzle);
  for (let i = 1; i < puzzle.moves.length; i += 2) {
    await waitForPlacement(page, chess, i === 1 ? `the position after ${puzzle.id}'s setup move` : `the reply to move ${i}`);
    await clickMove(page, puzzle.moves[i]);
    chess.move(uciToMove(puzzle.moves[i]));
    if (i + 1 < puzzle.moves.length) chess.move(uciToMove(puzzle.moves[i + 1]));
  }
  if (opts.ends) return;
  await expect(page.getByTestId('my-score'), `score after solving ${puzzle.id}`).toHaveText(String(before + 1));
}

/**
 * Make one legal move that is not the solution and gives no checkmate (the runner accepts any mate), then
 * wait until the strike count has gone up by one. With `ends` the miss ends the battle (the HUD is replaced by the
 * end screen at once), so there is no strike count to wait for: the caller checks the end screen.
 */
export async function missPuzzle(page: Page, puzzle: Puzzle, opts: { ends?: boolean } = {}): Promise<void> {
  const before = await myStrikes(page);
  const chess = afterSetup(puzzle);
  await waitForPlacement(page, chess, `the position after ${puzzle.id}'s setup move`);
  const solution = puzzle.moves[1];
  const wrong = chess.moves({ verbose: true }).find((m) => {
    if (m.promotion || m.from + m.to === solution.slice(0, 4)) return false;
    const next = new Chess(chess.fen());
    next.move(m);
    return !next.isCheckmate();
  });
  if (!wrong) throw new Error(`No wrong move available in ${puzzle.id}`);
  await clickMove(page, wrong.from + wrong.to);
  if (opts.ends) return;
  await expect(page.getByTestId('my-strikes'), `strikes after missing ${puzzle.id}`).toHaveAttribute('aria-label', `${before + 1} strikes`);
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Friend battle steps                                                                                             */
/* ------------------------------------------------------------------------------------------------------------- */

export interface FriendChoice {
  time?: '1 min' | '3 min' | '5 min';
  level?: 'Easier' | 'Normal' | 'Harder';
  series?: 'Best of 1' | 'Best of 3';
}

/** Pick options in the "Play a friend" card (the first set of pickers on the page). */
export async function chooseFriendSettings(page: Page, choice: FriendChoice): Promise<void> {
  const pick = async (group: string, option: string) => {
    const radio = page.getByRole('radiogroup', { name: group }).first().getByRole('radio', { name: option });
    await radio.click();
    await expect(radio).toBeChecked();
  };
  if (choice.time) await pick('Time', choice.time);
  if (choice.level) await pick('Difficulty', choice.level);
  if (choice.series) await pick('Series', choice.series);
}

/** Type a friend's code into the "Play a friend" box and press Challenge. */
export async function sendChallenge(page: Page, code: string): Promise<void> {
  await page.getByLabel("Enter a friend's code").fill(code);
  await page.getByRole('button', { name: 'Challenge', exact: true }).first().click();
}

/** The invitation card. */
export const invitation = (page: Page): Locator => page.getByRole('alert').filter({ hasText: 'challenges you to a Puzzle Battle' });

export const countdown = (page: Page): Locator => page.getByRole('dialog', { name: 'Battle starting' });

/** Both players are past the "3, 2, 1, GO" card and the first puzzle is on the board. */
export async function expectPlaying(...players: Player[]): Promise<void> {
  for (const p of players) {
    await expect(countdown(p.page)).toBeHidden({ timeout: 20_000 });
    await expect(pill(p.page)).toBeVisible({ timeout: 20_000 });
  }
}

/** Read the pill text of a page ("#1 · 553"). */
export async function pillText(page: Page): Promise<string> {
  return (await pill(page).innerText()).trim();
}

/** Back to the lobby from an end screen. */
export async function backToLobby(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Back to lobby' }).click();
  await expect(page.getByRole('button', { name: 'Find opponent' })).toBeVisible();
}

/** The big battle rating on the lobby hero card. */
export function lobbyRating(page: Page): Locator {
  return page.getByText('Battle rating', { exact: true }).locator('xpath=following-sibling::div[1]');
}

/** Open the share link `/battle?club=CODE` and press Join. */
export async function joinClubByLink(p: Player, code: string): Promise<void> {
  await p.page.goto(`/battle?club=${code.replace('-', '')}`);
  await expect(p.page.getByLabel('Join with a code')).toHaveValue(code);
  await p.page.getByRole('button', { name: 'Join', exact: true }).click();
}
