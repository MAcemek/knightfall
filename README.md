# Knightfall

A fast, satisfying chess trainer: rated puzzles with streaks, a daily puzzle, a timed rush mode,
real-time head-to-head puzzle battles, a custom puzzle editor with shareable links, and a Stockfish
game review for your own Lichess and chess.com games.

> Knightfall is an independent open project. It is inspired by the general mechanics of popular puzzle
> trainers but uses its own name, design, sounds and code. Puzzles come from the
> [Lichess puzzle database](https://database.lichess.org/#puzzles), released under CC0.

## Modes

| Mode | Route | What it is |
| --- | --- | --- |
| **Puzzles** | `/puzzles` | Glicko-2 rated puzzles picked near your rating. Clean solves gain rating, hinted solves are neutral, misses cost rating. Solve streak with milestones, hints (H), retry (R, unrated), solution (S), flip (F), auto-next, and a replayable history strip |
| **Train** | `/train` | Theme training (forks, pins, mates…) and a spaced-repetition queue of puzzles you missed |
| **Daily** | `/daily` | One puzzle per UTC day, identical for everyone. Daily streak, countdown to the next puzzle, month calendar; past days can be played late (shown on the calendar, not counted for the streak). Spoiler-free share text |
| **Rush** | `/rush` | 3 min / 5 min / Survival. Difficulty ramps up, combos build, three strikes and you're out. Personal bests per mode, game-over stats and an untimed review of every puzzle in the run |
| **Battle** | `/battle` | Live 1v1 over WebSocket: same puzzle sequence for both players, 3 minutes, 3 strikes, Elo rating. A sparring bot steps in after ~8 s if nobody else is queued. Rematch, new opponent, resign |
| **Custom** | `/custom` | Board editor → record the solution → optional engine check → add title, themes and difficulty → save locally. Play, edit, share as a self-contained link (`/custom/s#…`), export/import JSON |
| **Game Review** | `/analysis` | Paste a Lichess or chess.com link or a PGN, or import recent games by username. Stockfish runs in your browser (plus Lichess cloud evals for known positions): accuracy per side, classified moves, eval graph, key moments, free exploration, and "practise your mistakes", which turns your errors into puzzles |
| **Stats** | `/stats` | Rating chart, theme strengths, activity heatmap and achievements |
| **Settings** | `/settings` | Board theme, coordinates, sound and volume, animation speed, auto-next |

All progress is stored locally in your browser (IndexedDB). There are no accounts.

## Quick start

Requires Node 20 or newer.

```bash
npm install
npm run dev       # web on http://localhost:5173, server (battles + chess.com lookup) on :8787
```

The repository already includes a ready-built puzzle set (up to 1,200 puzzles per 100-point rating bucket), the opening book and the Stockfish lite engine, so
`npm run dev` works straight after install. Optional extras:

```bash
npm run puzzles      # rebuild the puzzle set from the full Lichess puzzle DB (~300 MB download, cached in data/)
npm run engine:deep  # fetch the full Stockfish 19 build (~99 MB, not committed) for deeper game reviews
```

`npm test` runs every unit test; `npm run typecheck` and `npm run build` check everything.

## Deploy

**Vercel (site + API).** Import the repository on [vercel.com/new](https://vercel.com/new) and keep the
defaults: `vercel.json` runs `scripts/build-vercel.mjs`, which writes the Vite build and a small function
for `/api/*` (the chess.com lookup) in Vercel's Build Output format. Every mode except live Battle works
on Vercel as is.

**Battle server (optional).** Vercel functions can't hold WebSocket connections, so live Battle needs
`apps/server` on a Node host. `render.yaml` sets it up on Render's free plan (New → Blueprint → this repo);
free services sleep when idle, and the Battle page wakes them and waits up to a minute. Any other Node host
works too:

```bash
npm ci
NODE_ENV=production PORT=8787 npm start -w @knightfall/server
```

Then set `VITE_BATTLE_URL=wss://<your-battle-host>/ws` in the Vercel project's environment variables and
redeploy. Without it, the Battle page says the battle server is offline.

## Layout

```
packages/core     shared TS: puzzle types, move judging, Glicko-2/Elo, seeded sequences, daily picker,
                  battle protocol, game analysis (win%, accuracy, move classes, link and PGN parsing)
apps/web          Vite + React + Tailwind client
  src/shared      Board, PuzzlePlayer, fx (synth sounds, particles), db (Dexie), engine (Stockfish worker
                  pool, cloud evals), importers (Lichess, chess.com), settings, progress
  src/features    one folder per mode: puzzles, train, daily, rush, battle, custom, analysis, stats, settings, home
apps/server       Node HTTP + ws server: battle matchmaking, rooms, authoritative clock; chess.com game lookup
scripts           build-puzzles, build-openings, fetch-engine, fit-rating, build-vercel
```

## Network use

Knightfall talks only to public endpoints and never sends credentials:

- Game Review fetches games from `lichess.org` and `api.chess.com`, and position evaluations from the
  Lichess cloud-eval API.
- A chess.com game link is resolved by Knightfall's own server, which looks the game up on chess.com
  (cached, rate-limited, numeric game IDs only).
- Battles connect to Knightfall's own WebSocket server.

## Credits

- Puzzles: Lichess puzzle database (CC0).
- Piece set: "cburnett" by Colin M.L. Burnett (CC BY-SA 3.0 / GPL), via Lichess.
- Openings: lichess-org/chess-openings (CC0).
- Engine: Stockfish via stockfish.js 19.0.1 (GPL-3.0), shipped unmodified as separate files. See `THIRD_PARTY_NOTICES.md`.
- All sound effects are synthesized at runtime with the Web Audio API.

## License

Knightfall's code is MIT licensed (see `LICENSE`). Bundled third-party files keep their own licenses; see `THIRD_PARTY_NOTICES.md`.
