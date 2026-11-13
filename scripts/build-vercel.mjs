// Build Knightfall for Vercel using the Build Output API (https://vercel.com/docs/build-output-api/v3).
//
//   .vercel/output/static              the Vite build of apps/web (the whole site, engine and puzzles included)
//   .vercel/output/functions/api.func  apps/server/src/vercelApi.ts bundled with esbuild (chess.com lookup)
//   .vercel/output/config.json         /api/* -> the function, everything else -> files, then the SPA shell
//
// Live Battle needs a long-lived WebSocket server, which Vercel functions cannot host. Run apps/server on
// any Node host and set VITE_BATTLE_URL (e.g. wss://battle.example.com/ws) in the Vercel project; without
// it the Battle page says battles are unavailable on this deployment.
//
//   node scripts/build-vercel.mjs

import { execSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const OUT = '.vercel/output';

await rm(OUT, { recursive: true, force: true });
execSync('npm run build -w @knightfall/web', { stdio: 'inherit' });
await mkdir(OUT, { recursive: true });
await cp('apps/web/dist', `${OUT}/static`, { recursive: true });

const fn = `${OUT}/functions/api.func`;
await mkdir(fn, { recursive: true });
await build({
  entryPoints: ['apps/server/src/vercelApi.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
});
await writeFile(`${fn}/package.json`, JSON.stringify({ type: 'module' }));
await writeFile(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 30 }, null, 2),
);

await writeFile(
  `${OUT}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/(api(?:/.*)?)$', dest: '/api?path=/$1' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel output written to ${OUT}`);
