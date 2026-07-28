# Phase 4 — WASM browser decoder

> 2026-07-28 · Node v26 · darwin/arm64 · emcc 6.0.4 · OpenZL from `./openzl` (wasm64)

## Artifacts

| File | Size |
|------|-----:|
| `browser/dist/openzl_decode.wasm` | 1 389 157 bytes (~1.33 MiB) |
| `browser/dist/openzl_decode.js` | ~12 KB glue |

Build: `npm run build:wasm` (requires `emcc`, OpenZL sources, **MEMORY64**).

## Correctness

CLI `zli compress -p serial` → WASM `openzl_decompress`: **round-trip OK**
(`browser/test-decode.mjs`).

## Decode latency (Node, main-thread style)

Payload: ~29 KB JSON → ~1.6 KB OpenZL frame.

| | ms |
|--|---:|
| p50 | 0.043 |
| min | 0.040 |
| max | 0.075 |

Decode CPU is not the problem. **Download of the decoder is.**

## Amortization (transfer only)

Rule: `wasm_bytes + Σ openzl < Σ gzip`.

Example (this payload):

| | bytes |
|--|------:|
| raw | 29 156 |
| openzl | 1 673 |
| gzip L6 | ~2 509 |
| save per response vs gzip | ~836 |
| wasm | 1 389 157 |
| **break-even** | **~1 662 responses** in a session |

With **10** responses: OpenZL path still pays ~1.4 MB; gzip path ~25 KB → **not worth it**.

### When it *is* worth it

- Many large typed/binary payloads per session (Phase 3 ratios help)
- Decoder cached long-term (Service Worker / HTTP cache) amortized across days
- Bandwidth expensive and payloads huge (multi-MB sessions)

### When it is *not*

- Landing pages, one-shot API calls, small JSON
- Browsers without wasm64 → force gzip negotiation

## Browser note

Module is **wasm64**. Check target browsers before shipping OpenZL as default for web clients. Always offer `gzip` in `Accept-Encoding` as fallback.

## API sketch

```js
import { createDecoder, amortization } from './browser/openzl-decoder.js';
import { createOpenZLFetch } from './browser/fetch-openzl.js';

const dec = await createDecoder();
const json = dec.decompressJSON(frameBytes);

const fetchOzl = await createOpenZLFetch();
const res = await fetchOzl(url, { headers: { 'Accept-Encoding': 'openzl, gzip' } });
```
