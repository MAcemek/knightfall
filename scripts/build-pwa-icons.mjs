// One-off: render the PWA icons from the app's knight logo (apps/web/public/pieces/wN.svg, shown mirrored
// in the header) onto the midnight-ink background, using headless Chromium from Playwright.
//
//   node scripts/build-pwa-icons.mjs
//
// Writes apps/web/public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png (committed).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const OUT = 'apps/web/public/icons';
const svg = (await readFile('apps/web/public/pieces/wN.svg', 'utf8')).trim();
const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// scale = knight size as a fraction of the icon. Maskable icons keep the logo inside the central safe zone
// (a circle of 40% radius), so the knight is smaller there.
const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 0.7 },
  { file: 'icon-512.png', size: 512, scale: 0.7 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.68 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const { file, size, scale } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;width:${size}px;height:${size}px;background:#0f1420}
      body{display:grid;place-items:center;background:radial-gradient(circle at 50% 55%,#252e45 0%,#0f1420 70%)}
      img{width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px;transform:scaleX(-1);filter:drop-shadow(0 0 ${Math.round(size / 20)}px rgba(255,154,31,.45))}</style>
      <img src="${dataUri}">`,
    );
    await page.evaluate(() => document.querySelector('img').decode());
    await writeFile(`${OUT}/${file}`, await page.screenshot({ type: 'png' }));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Wrote ${ICONS.length} icons to ${OUT}`);
