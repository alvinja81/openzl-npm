# Browser OpenZL decoder (Phase 4)

Decode `Content-Encoding: openzl` responses in the browser via WebAssembly.

## Artifacts

| File | Role |
|------|------|
| `dist/openzl_decode.wasm` | Decode-only OpenZL (~1.3 MB today) |
| `dist/openzl_decode.js` | Emscripten ES module glue |
| `openzl-decoder.js` | High-level `createDecoder()` + amortization |
| `fetch-openzl.js` | Drop-in `fetch` that auto-decodes OpenZL |
| `sw-openzl.js` | Optional Service Worker |
| `amortization.html` | Interactive break-even calculator |

## Build

```bash
# once: brew install emscripten
# once: openzl sources in ../openzl (already cloned in this repo)
npm run build:wasm
```

## Usage

```js
import { createDecoder, amortization } from './openzl-decoder.js';
import { createOpenZLFetch } from './fetch-openzl.js';

const decode = await createDecoder();
const bytes = decode.decompress(compressedUint8Array);
const json = decode.decompressJSON(compressedUint8Array);

// Transparent fetch
const fetchOzl = await createOpenZLFetch();
const res = await fetchOzl('/api/items', {
  headers: { 'Accept-Encoding': 'openzl, gzip' }
});
console.log(await res.json());
```

## Important: wasm64 (MEMORY64)

OpenZL asserts `sizeof(size_t) == 8`. The module is built with **wasm64 / MEMORY64**.

- **Node 22+**: works for tests (`node browser/test-decode.mjs`).
- **Browsers**: need wasm64 support (Chrome ~133+, check [webassembly.org](https://webassembly.org/features/) / caniuse for your targets).
- If a client cannot load wasm64, fall back to `Accept-Encoding: gzip` only.

## Amortization

```js
import { amortization } from './openzl-decoder.js';

const r = amortization({
  wasmBytes: 1_360_000,   // openzl_decode.wasm size
  openzlTotal: 500_000,   // sum of openzl bodies this session
  gzipTotal: 800_000      // same payloads as gzip
});
// r.worthIt, r.saved, r.breakEvenOpenzlBytes
```

Or open `amortization.html` in a browser.

**Rough rule:** with a ~1.3 MB decoder, you need the session to save more than ~1.3 MB vs gzip (sum of size deltas) before OpenZL is a win on pure transfer. Latency/CPU on main thread is a separate cost — native browser gzip/zstd often decode off-thread for free.

## Smoke test

```bash
# compress with zli, decode with wasm
zli compress sample.json -o /tmp/t.zl -p serial -f
node browser/test-decode.mjs /tmp/t.zl
```
