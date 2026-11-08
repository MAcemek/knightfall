# Knightfall

A fast, satisfying chess-tactics trainer: rated puzzles with streaks, a daily puzzle, a timed rush mode,
real-time head-to-head puzzle battles, and a custom puzzle editor with shareable links.

> Knightfall is an independent open project. It is inspired by the general mechanics of popular puzzle
> trainers but uses its own name, design, sounds and code. Puzzles come from the
> [Lichess puzzle database](https://database.lichess.org/#puzzles), released under CC0.

## Modes

| Mode | What it is |
| --- | --- |
| **Puzzles** | Glicko-2 rated puzzles picked near your rating, solve streaks, hints, retry & solution replay |
| **Daily** | One puzzle per UTC day, identical for everyone, with a daily streak and calendar |
| **Rush** | 3 min / 5 min / Survival. Difficulty ramps up; three strikes and you're out |
| **Battle** | Live 1v1 over WebSocket: same puzzle sequence, 3 minutes, 3 strikes, Elo rating |
| **Custom** | Board editor → record a solution → save locally → share via link |

## Quick start

```bash
npm install
npm run puzzles   # downloads the Lichess puzzle DB (~300 MB, cached in data/) and builds public/puzzles
npm run dev       # web on http://localhost:5173, battle server on ws://localhost:8787/ws
```

`npm test` runs the core unit tests, `npm run typecheck` / `npm run build` check everything.

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
