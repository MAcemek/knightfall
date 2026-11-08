# Knightfall

A fast, satisfying chess-tactics trainer: rated puzzles with streaks, a daily puzzle, a timed rush mode,
real-time head-to-head puzzle battles, and a custom puzzle editor with shareable links.

> Knightfall is an independent open project. It is inspired by the general mechanics of popular puzzle
> trainers but uses its own name, design, sounds and code. Puzzles come from the
> [Lichess puzzle database](https://database.lichess.org/#puzzles), released under CC0.

## Modes

| Mode | Route | What it is |
| --- | --- | --- |
| **Puzzles** | `/puzzles` | Glicko-2 rated puzzles picked near your rating. Clean solves gain rating, hinted solves are neutral, misses cost rating. Solve streak with milestones, hints (H), retry (R, unrated), solution (S), flip (F), auto-next, and a replayable history strip |
| **Daily** | `/daily` | One puzzle per UTC day, identical for everyone. Daily streak, countdown to the next puzzle, month calendar; past days can be played late (shown on the calendar, not counted for the streak). Spoiler-free share text |
| **Rush** | `/rush` | 3 min / 5 min / Survival. Difficulty ramps up, combos build, three strikes and you're out. Personal bests per mode, game-over stats and an untimed review of every puzzle in the run |
| **Battle** | `/battle` | Live 1v1 over WebSocket: same puzzle sequence for both players, 3 minutes, 3 strikes, Elo rating. A sparring bot steps in after ~8 s if nobody else is queued. Rematch, new opponent, resign |
| **Custom** | `/custom` | Board editor → record the solution → add title, themes and difficulty → save locally. Play, edit, share as a self-contained link (`/custom/s#…`), export/import JSON |

## Quick start

```bash
npm install
npm run puzzles   # downloads the Lichess puzzle DB (~300 MB, cached in data/) and builds public/puzzles
npm run dev       # web on http://localhost:5173, battle server on ws://localhost:8787/ws
```

`npm test` runs every unit test (core rules, server rooms/matchmaking, and each mode's pure logic); `npm run typecheck` / `npm run build` check everything.

## Layout

```
packages/core     shared TS: puzzle types, move judging, Glicko-2/Elo, seeded sequences, daily picker, battle protocol
apps/web          Vite + React + Tailwind client
  src/shared      Board, PuzzlePlayer (runner hook), fx (synth sounds, particles, tickers), db (Dexie), puzzleSource
  src/features    one folder per mode: puzzles, daily, rush, battle, custom, home
apps/server       Node + ws battle server (matchmaking, rooms, authoritative clock)
scripts           build-puzzles.mjs (Lichess CSV.zst → rating buckets)
```

## Credits

- Puzzles: Lichess puzzle database (CC0).
- Piece set: "cburnett" by Colin M.L. Burnett (CC BY-SA 3.0 / GPL), via Lichess.
- All sound effects are synthesized at runtime with the Web Audio API.
