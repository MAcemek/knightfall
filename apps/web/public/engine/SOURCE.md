# Stockfish engine files

These files are **unmodified** copies from the npm package [`stockfish@17.1.0`](https://www.npmjs.com/package/stockfish/v/17.1.0)
(Stockfish.js by Nathan Rugg / Chess.com, a WebAssembly build of [Stockfish](https://github.com/official-stockfish/Stockfish)).

- License: **GPL-3.0** (full text in `COPYING.txt` next to this file)
- Corresponding source: https://github.com/nmrugg/stockfish.js/tree/v17.1.0
- Package tarball: https://registry.npmjs.org/stockfish/-/stockfish-17.1.0.tgz
- Tarball integrity: `sha512-LvxdOzngaMjwdDKkZML4riABX9EWUkIE2ZJUsNvR2yFnM4WLiM6ggEXcBY8v53dK7uAfbxdJFcBiKTIQyGg6Zg==`
- Fetched by: `node scripts/fetch-engine.mjs`

| File | Bytes | sha256 |
| --- | --- | --- |
| `stockfish-17.1-lite-single-03e3232.js` | 20672 | `1c8265e52fdaef797684b4979b42c5dcfe0350df3e11a87e48e4ec5f86e0ca5c` |
| `stockfish-17.1-lite-single-03e3232.wasm` | 7280741 | `7ca31bedd166148931a1cc84dbd8dd9cf001744e9994caf23a3c6ff4988d7086` |

Knightfall loads the engine as a separate Web Worker and talks to it over the text-based UCI protocol.
Knightfall's own source code is MIT licensed and is not derived from these files.
