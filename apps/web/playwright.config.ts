import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * Battle tests: real Chrome windows play a friend battle and a club race against a real battle server.
 * Everything runs on its own ports (battle server 8788, built web app 4174), so `npm run dev` (5173/8787)
 * can stay open. Run from the repo root with `npm run e2e`.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const SERVER_PORT = '8788';
const WEB_PORT = '4174';
const ci = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: 'chrome',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: 'phone.spec.ts', use: { viewport: { width: 1280, height: 800 } } },
    {
      name: 'phone',
      testMatch: 'phone.spec.ts',
      use: { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      // A small phone (360x640): the same flow, to catch what only breaks on the shortest screens.
      name: 'phone-small',
      testMatch: 'phone.spec.ts',
      use: { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: [
    {
      command: 'npm run start -w @knightfall/server',
      cwd: root,
      env: { KF_SERVER_PORT: SERVER_PORT },
      url: `http://localhost:${SERVER_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // A production build, served by `vite preview`, which reuses the dev proxy (/ws and /api go to the test server).
      command: `npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port ${WEB_PORT} --strictPort`,
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env: { KF_SERVER_PORT: SERVER_PORT, VITE_BATTLE_URL: '' },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
