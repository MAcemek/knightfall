# Stockfish engine files

These files are **unmodified** copies from the npm package [`stockfish@19.0.1`](https://www.npmjs.com/package/stockfish/v/19.0.1)
(Stockfish.js by Nathan Rugg / Chess.com, a WebAssembly build of [Stockfish](https://github.com/official-stockfish/Stockfish)).

- License: **GPL-3.0** (full text in `COPYING.txt` next to this file)
- Corresponding source: https://github.com/nmrugg/stockfish.js/tree/v19.0.1
- Package tarball: https://registry.npmjs.org/stockfish/-/stockfish-19.0.1.tgz
- Tarball integrity: `sha512-bTwsO4e9HAwPBKls1+szcfibmaWRNzTF20rQE/XPdB3LOSoT6XTZDr1zYwriwSRRFT5MkvqrglPmJrKEVXGnyQ==`
- Fetched by: `node scripts/fetch-engine.mjs`

| File | Bytes | sha256 |
| --- | --- | --- |
| `stockfish-19-lite-single.js` | 28230 | `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a` |
| `stockfish-19-lite-single.wasm` | 1845971 | `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de` |

Knightfall loads the engine as a separate Web Worker and talks to it over the text-based UCI protocol.
Knightfall's own source code is MIT licensed and is not derived from these files.
