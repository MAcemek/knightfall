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
| **Train** | `/train` | Theme training (forks, pins, mates…) and a spaced-repetition queue of puzzles you missed. **Weak spots** (`/train/weak`) picks the themes you miss most and rotates through them; **From my games** (`/train/games`) turns the mistakes in your analysed games into puzzles automatically; **Openings** (`/train/openings`) drills the named lines of the openings you pick with spaced repetition; **Endgames** (`/train/endgames`) plays key endings against perfect defence from the Lichess tablebase; **Board vision** (`/train/vision`) has timed drills to find and name squares and to plan knight routes, from White's or Black's side |
| **Daily** | `/daily` | One puzzle per UTC day, identical for everyone. Daily streak, countdown to the next puzzle, month calendar; past days can be played late (shown on the calendar, not counted for the streak). Spoiler-free share text |
| **Rush** | `/rush` | 3 min / 5 min / Survival. Difficulty ramps up, combos build, three strikes and you're out. Personal bests per mode, game-over stats and an untimed review of every puzzle in the run |
| **Battle** | `/battle` | Live 1v1 over WebSocket: same puzzle sequence for both players, 3 minutes, 3 strikes, Elo rating. A sparring bot steps in after ~8 s if nobody else is queued. Rematch, new opponent, resign. Or challenge a friend by code (casual, unrated; invitations arrive on any page) with your choice of time (1/3/5 min), difficulty and best of 1 or 3, and re-challenge **recent opponents** in one tap. A **club room** lets a host open a room code where everyone races the same puzzles at once with a live ranking (single race, spectators can join mid-race) |
| **Custom** | `/custom` | Board editor → record the solution → optional engine check → add title, themes and difficulty → save locally. Play, edit, share as a self-contained link (`/custom/s#…`), export/import JSON |
| **Game Review** | `/analysis` | Paste a Lichess or chess.com link or a PGN, or import recent games by username. Stockfish runs in your browser (plus Lichess cloud evals for known positions): search depth 16 (Deep: 20), accuracy per side, classified moves, eval graph, a game summary card (what went well, the turning points, one thing to practise), a short note on each move of an engine line, free exploration, and "practise your mistakes", which turns your errors into puzzles. A setting (off, slow games or all games) can make you write down where you think the game went wrong before the engine's answer is shown. Starting a Coach plan turns it on for slow games |
| **Woodpecker** | `/train/woodpecker` | Make a fixed set of puzzles and solve all of them again and again, each cycle in fewer days. Pace per day, accuracy and median time per cycle, and a practice round for the misses |
| **Blunder check** | `/train/blunder-check` | Is the planned move safe? Look for checks, captures and threats before you play it. Counts toward the Coach's daily list |
| **Bot games** | `/play` | Slow training games against a limited-strength Stockfish in your browser. Each move is held until you have ticked the blunder check. Games are stored so you can review them |
| **Coach** | `/coach` | A 12-week plan: a short list of tasks for each day (Woodpecker, Rush, blunder check, study, Daily games, weekend rapid games and reviews), a bullet limit of 10 a week, a blitz stop rule after two losses in a row, a task list that adapts to you (a focus theme from your mistakes, Woodpecker catch-up advice, a higher blunder check target after many blunders), a Week page with a review of each plan week (the same weeks as the Today page) and advice for the next one, a rating chart against your targets, a helper for Daily games with no board or engine, and a library of videos, books and tools. Everything stays in this browser |
| **Stats** | `/stats` | Rating chart, theme strengths, activity heatmap and achievements |
| **Settings** | `/settings` | Board theme, coordinates, sound and volume, animation speed, auto-next, and **Backup**: save all progress to a file and restore it here or on another device |

All progress is stored locally in your browser (IndexedDB). There are no accounts, so keep a backup file
(Settings, then Backup). Restoring replaces everything on that device; the file never contains your friend code or its
secret token.

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
npm run engine:deep  # fetch the full Stockfish 17 build (~79 MB, not committed) for deeper game reviews
```

`npm test` runs every unit test; `npm run typecheck` and `npm run build` check everything. `npm run e2e` plays real
battles and a club race in Google Chrome, on desktop and phone sizes, against its own test server (about 3 minutes).

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
  src/features    one folder per mode: puzzles, train, daily, rush, battle, custom, analysis, play, woodpecker,
                  blundercheck, coach, stats, settings, home
  e2e             Playwright battle tests (npm run e2e)
apps/server       Node HTTP + ws server: battle matchmaking, rooms, authoritative clock; chess.com game lookup
scripts           build-puzzles, build-openings, fetch-engine, fit-rating, build-vercel
```

## Install / offline

Knightfall is installable as an app (Settings, then Install Knightfall, or your browser's install option; on
iPhone use Share, then Add to Home Screen). Once the site has loaded online it works offline for puzzles and
for reviews you saved (the Stockfish engine is cached after your first review). Importing games, cloud
evaluations and Battle need an internet connection. When a new version is deployed, open pages switch to it
by themselves, on a calm page or at your next page change, never in the middle of a puzzle, game or a running review.

## Network use

Knightfall talks only to public endpoints and never sends credentials:

- Game Review fetches games from `lichess.org` and `api.chess.com`, and position evaluations from the
  Lichess cloud-eval API.
- A chess.com game link is resolved by Knightfall's own server, which looks the game up on chess.com
  (cached, rate-limited, numeric game IDs only).
- Endgame drills query the Lichess tablebase at `tablebase.lichess.ovh` (GET, position FEN only, no credentials; not cached offline).
- With a Coach plan that has a chess.com username, the Coach reads that player's public ratings and games from
  `api.chess.com` when it is opened (at most once every 15 minutes) or when Sync is pressed. Only the username is sent.
- Battles connect to Knightfall's own WebSocket server.
- While the app is open it keeps a connection to Knightfall's battle server (for friend challenges and Puzzle Battle).
  The connection shares your display name and battle rating with that server, plus a random friend code and token. In a friend battle your friend code is shared with your opponent so they can re-challenge you.

## Credits

- Puzzles: Lichess puzzle database (CC0).
- Piece set: "cburnett" by Colin M.L. Burnett (CC BY-SA 3.0 / GPL), via Lichess.
- Openings: lichess-org/chess-openings (CC0).
- Engine: Stockfish via stockfish.js 17.1.0 (GPL-3.0), shipped unmodified as separate files. See `THIRD_PARTY_NOTICES.md`.
- All sound effects are synthesized at runtime with the Web Audio API.

## License

Knightfall's code is MIT licensed (see `LICENSE`). Bundled third-party files keep their own licenses; see `THIRD_PARTY_NOTICES.md`.
