# Browser OpenZL decoder — **experimental**

> **Phase 10 decision:** browser decode is **not** a primary product surface.
> Default clients are **Node + gzip/zstd**. Use this only if you control both ends and have measured break-even.

Decode `Content-Encoding: openzl` in the browser via WebAssembly (wasm64).

## Status

| | |
|--|--|
| Stability | **Experimental** — API may change |
| WASM size | **~1.3 MB** (`dist/openzl_decode.wasm`) |
| ISA | **wasm64 / MEMORY64** (OpenZL is 64-bit only today) |
| Recommendation | Prefer gzip/zstd for public web UIs |

Full rationale: [`docs/BROWSER.md`](../docs/BROWSER.md).

## Artifacts

| File | Role |
|------|------|
| `dist/openzl_decode.wasm` | Decode-only OpenZL (~1.3 MB) |
| `dist/openzl_decode.js` | Emscripten ES module glue |
| `openzl-decoder.js` | High-level `createDecoder()` + amortization |
| `fetch-openzl.js` | Drop-in `fetch` that auto-decodes OpenZL |
| `sw-openzl.js` | Optional Service Worker |
| `amortization.html` | Interactive break-even calculator |
| `index.js` | Experimental entry (console warning once) |

## Build

```bash
# once: brew install emscripten
npm run build:wasm
```

## Usage (advanced)

```js
import { createDecoder, amortization } from 'openzl-express/browser/openzl-decoder.js';
// or: import { createDecoder } from 'openzl-express/browser';  // warns once

const decode = await createDecoder();
const bytes = decode.decompress(compressedUint8Array);

// Always keep gzip for clients without wasm64
fetch(url, { headers: { 'Accept-Encoding': 'openzl, gzip' } });
```

## Important: wasm64

- **Node 22+**: `node browser/test-decode.mjs` works for smoke tests.
- **Browsers**: need wasm64 (Chrome ~133+; check caniuse / webassembly.org).
- Without wasm64 → **do not** request `openzl`; use gzip/zstd only.

## Amortization rule of thumb

With a ~1.3 MB decoder, session transfer savings vs gzip must exceed ~1.3 MB before OpenZL wins on pure bytes. CPU/main-thread cost is extra.

```js
import { amortization } from './openzl-decoder.js';
amortization({ wasmBytes: 1_360_000, openzlTotal: 500_000, gzipTotal: 800_000 });
```

## Smoke test

```bash
zli compress sample.json -o /tmp/t.zl -p serial -f
node browser/test-decode.mjs /tmp/t.zl
```
