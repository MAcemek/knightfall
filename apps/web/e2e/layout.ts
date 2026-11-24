import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Player } from './helpers.ts';

/**
 * Phone layout checks with real bounding boxes. Every check is a soft assertion, so one wrong stage does not
 * hide the stages after it; the measurements of each stage are attached to the test as JSON.
 */

/** Smallest height a tap target may have (the app aims for 44). */
export const MIN_TAP_PX = 40;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Measured {
  vw: number;
  vh: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  scrollY: number;
  navTop: number | null;
  board: Box | null;
  clock: Box | null;
  mine: Box | null;
  opp: Box | null;
  rank: Box | null;
  prompt: Box | null;
  stepper: Box | null;
  /** Buttons, links and inputs under MIN_TAP_PX tall. */
  small: { what: string; h: number; w: number }[];
  /** Furthest any part of an open dialog sticks out of the viewport sideways. */
  dialogOverflow: number;
}

export interface StageOptions {
  /** Check the live battle layout (clock, scores or rank, whole board) and that the page is at the top. */
  play?: 'start' | 'later';
  /** Assert the page is scrolled to the very top (the end screen, club results). Implied by play: 'start'. */
  atTop?: boolean;
  /** Wait (up to 2.5 s) for entrance animations to stop sticking out of the viewport before measuring. */
  settle?: boolean;
  /** Also save a screenshot (default true). */
  shot?: boolean;
}

const SHOT_ROOT = fileURLToPath(new URL('../test-results/', import.meta.url));

function measure(page: Page): Promise<Measured> {
  return page.evaluate((minTap) => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    };
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || n.getAttribute('aria-hidden') === 'true') return false;
      }
      return true;
    };
    const squares = ['a1', 'a8', 'h1', 'h8'].map((s) => document.querySelector(`[data-square="${s}"]`)?.getBoundingClientRect());
    const board: Box | null = squares.every(Boolean)
      ? {
          left: Math.min(...squares.map((r) => r!.left)),
          top: Math.min(...squares.map((r) => r!.top)),
          right: Math.max(...squares.map((r) => r!.right)),
          bottom: Math.max(...squares.map((r) => r!.bottom)),
        }
      : null;
    const rankLabel = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent === 'Your rank');

    const roots = [document.querySelector('main'), ...document.querySelectorAll('[role="alert"], [role="dialog"]')].filter((e): e is Element => !!e);
    const seen = new Set<Element>();
    const small: Measured['small'] = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="radio"]')) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.height < minTap) {
          const what = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || el.getAttribute('href') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
          small.push({ what: `${el.tagName.toLowerCase()} "${what}"`, h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10 });
        }
      }
    }

    const vw = document.documentElement.clientWidth;
    let dialogOverflow = 0;
    for (const dlg of document.querySelectorAll('[role="dialog"]')) {
      for (const el of dlg.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) dialogOverflow = Math.max(dialogOverflow, r.right - vw, -r.left);
      }
    }
    const nav = [...document.querySelectorAll('nav')].find((n) => getComputedStyle(n).position === 'fixed');
    return {
      vw,
      vh: window.innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      scrollY: window.scrollY,
      navTop: nav ? nav.getBoundingClientRect().top : null,
      board,
      clock: box(document.querySelector('[aria-label="Time left"], [aria-label="Starts in"]')),
      mine: box(document.querySelector('[data-testid="my-score"]')),
      opp: box(document.querySelector('[data-testid="opp-score"]')),
      rank: box(rankLabel ?? null),
      prompt: box(document.querySelector('[data-testid="prompt-line"]')),
      stepper: box([...document.querySelectorAll('[aria-label="Previous move"]')].find((e) => e.getBoundingClientRect().width > 0) ?? null),
      small,
      dialogOverflow: Math.round(dialogOverflow * 10) / 10,
    };
  }, MIN_TAP_PX);
}

const fmt = (b: Box | null): string => (b ? `[${b.left.toFixed(0)},${b.top.toFixed(0)} to ${b.right.toFixed(0)},${b.bottom.toFixed(0)}]` : 'missing');

/** Run the layout checks for one stage of the flow and save its screenshot. */
export async function checkStage(player: Player, name: string, opts: StageOptions = {}): Promise<void> {
  const { page } = player;
  const stage = `${name} (${player.name})`;
  // Later stages are measured from the top, so a scroll problem at the start of play is not repeated at every stage.
  if (opts.play === 'later') await page.evaluate(() => window.scrollTo(0, 0));
  let m = await measure(page);
  for (let i = 0; opts.settle && m.dialogOverflow > 1 && i < 25; i++) {
    await page.waitForTimeout(100); // entrance animation: nothing to observe but the geometry itself
    m = await measure(page);
  }
  await test.info().attach(`layout-${name}-${player.name}.json`, { body: JSON.stringify(m, null, 2), contentType: 'application/json' });

  expect.soft(Math.max(m.docScrollWidth, m.bodyScrollWidth), `${stage}: the page scrolls sideways (content ${m.docScrollWidth}px wide, viewport ${m.vw}px)`).toBeLessThanOrEqual(m.vw);
  expect.soft(m.dialogOverflow, `${stage}: a dialog sticks out of the viewport by ${m.dialogOverflow}px`).toBeLessThanOrEqual(1);
  expect.soft(m.small, `${stage}: buttons, links or inputs under ${MIN_TAP_PX}px tall`).toEqual([]);

  if (opts.play) {
    const limit = Math.min(m.vh, m.navTop ?? m.vh);
    const parts: [string, Box | null][] = [
      ['clock', m.clock],
      ['your score', m.mine],
      m.opp ? ['opponent score', m.opp] : ['your rank', m.rank],
      ['whole board', m.board],
      ['prompt line under the board', m.prompt],
      // During normal play (no banner) the Back button must be reachable without scrolling.
      ...(opts.play === 'start' ? ([['Previous move button', m.stepper]] as [string, Box | null][]) : []),
    ];
    for (const [name, b] of parts) {
      if (!b) {
        expect.soft(b, `${stage}: ${name} not found`).not.toBeNull();
        continue;
      }
      const where = `${stage}: ${name} ${fmt(b)}, viewport ${m.vw}x${m.vh}, bottom nav starts at ${m.navTop}`;
      expect.soft(b.top, `${where} (top edge)`).toBeGreaterThanOrEqual(0);
      expect.soft(b.left, `${where} (left edge)`).toBeGreaterThanOrEqual(0);
      expect.soft(b.right, `${where} (right edge)`).toBeLessThanOrEqual(m.vw);
      expect.soft(b.bottom, `${where} (bottom edge; must be above the nav without scrolling)`).toBeLessThanOrEqual(limit);
    }
    if (opts.play === 'start') expect.soft(m.scrollY, `${stage}: play starts scrolled down by ${m.scrollY}px`).toBe(0);
  }
  if (opts.atTop) expect.soft(m.scrollY, `${stage}: the page is scrolled down by ${m.scrollY}px`).toBe(0);

  if (opts.shot !== false) {
    // One folder per project (phone, phone-small), so the two sizes do not overwrite each other.
    const dir = `${SHOT_ROOT}${test.info().project.name}/`;
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}${name}.png` });
  }
}
