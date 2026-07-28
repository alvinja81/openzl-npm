# openzl-express

Express middleware + Node core for [OpenZL](https://github.com/facebook/openzl) — Meta’s format-aware compression.

**Not a gzip replacement.** Opt-in clients (`Accept-Encoding: openzl`), gzip for everyone else, measured wins and losses.

```bash
npm install openzl-express
```

**Codec ladder (per request):** `openzl` (explicit opt-in) → **zstd** → **gzip** → identity  

**Install / OpenZL encode ladder:** native N-API → zli CLI → (zstd/gzip still work)  

Nothing fails `npm install`. Missing native/CLI means more zstd/gzip — not a broken app.

---

## Measured performance (honest)

### Encode latency (Apple Silicon, ~100 KB class)

| Backend | Encode p50 | Notes |
|---------|------------|--------|
| **Native N-API** | **~0.1–0.4 ms** | Phase 2; same class as zstd L3 |
| CLI `zli` pipes (raw binary) | ~2–4 ms | Phase 1 |
| CLI via Node launcher + temp files | ~30 ms | Phase 0 (fixed) |

Sources: `bench/results/phase0-baseline.md`, `phase1-baseline.md`, `phase2-baseline.md`.

### Ratio — trained profiles vs gzip / zstd (~100 KB)

| Corpus | gzip6 | zstd3 | openzl **trained** |
|--------|------:|------:|-------------------:|
| A api-list | 6.0% | 5.5% | **4.7%** (api-list) |
| B timeseries | 26.3% | 25.8% | **23.8%** (timeseries) |
| C prose | 2.9% | 2.0% | **2.1%** (prose) |
| F binary records | 62.9% | 52.5% | **13.8%** (binary) |

Full table: `bench/results/phase3-profiles.md`.

**Takeaway:** train on your shape. Binary/typed data is where OpenZL earns its name. Generic prose is competitive, not magic.

### Browser WASM decoder

| | |
|--|--:|
| `openzl_decode.wasm` | **~1.3 MB** (wasm64) |
| Decode p50 (~29 KB JSON) | **~0.04 ms** |
| Break-even vs gzip (transfer) | **~1.6k similar responses/session** before WASM download pays off |

Detail: `bench/results/phase4-wasm.md`, `browser/README.md`.

---

## Positioning (earned)

> Better ratio for shape-matched / typed payloads when you train. Competitive encode latency with the native addon. Opt-in clients only.

Not for every page. Fine.

---

## Quick start

### Express

```ts
import express from 'express';
import { openzlMiddleware } from 'openzl-express/express';
// or: import { openzlMiddleware } from 'openzl-express';

const app = express();
app.use(openzlMiddleware({
  threshold: 1024,
  profile: 'serial',           // or 'timeseries' | 'api-list' | 'binary' | path.zlc
  // selectProfile: (req) => req.path.startsWith('/metrics') ? 'timeseries' : 'api-list',
  fallbackToGzip: true,
  preferStreamGzip: true,      // sendFile streams gzip/zstd when client accepts both
}));

app.get('/api/data', (req, res) => {
  res.json({ data: [/* … */] });
});

app.listen(3000);
```

### Fastify

```ts
import Fastify from 'fastify';
import { openzlFastify } from 'openzl-express/fastify';

const app = Fastify();
await app.register(openzlFastify, { threshold: 1024, profile: 'serial' });
app.get('/api/data', async () => ({ data: [/* … */] }));
await app.listen({ port: 3000 });
```

### Core only (no framework)

```ts
import { compress, pickEncoding, compressBody } from 'openzl-express/core';
```

### Negotiation

| Client `Accept-Encoding` | Server |
|--------------------------|--------|
| `openzl` (explicit) | `Content-Encoding: openzl` |
| `zstd` (Node with zlib zstd) | `Content-Encoding: zstd` |
| `gzip` / `*` | `Content-Encoding: gzip` (`*` ≠ openzl/zstd by default) |
| `openzl, zstd, gzip` | prefers **openzl**, then zstd, then gzip |
| neither | uncompressed |

Browsers never get OpenZL by accident — they don’t send `openzl`.

### Coverage (Express)

Hooks `res.write` / `res.end` → covers **`res.json`**, **`res.send`**, multi-chunk streams, **`res.sendFile`**.

- **gzip:** real streaming (`zlib.createGzip`) — good TTFB  
- **openzl:** whole-body buffer then compress (no stream encoder yet)

### Core API (no Express)

```ts
import {
  compress, decompress, pickEncoding,
  isNativeAvailable, getActiveBackend, listProfiles
} from 'openzl-express';

pickEncoding('openzl, gzip;q=0.8'); // 'openzl'

const zl = await compress(Buffer.from(JSON.stringify(payload)), {
  profile: 'timeseries'
});
const raw = await decompress(zl);

console.log(await getActiveBackend()); // 'native' | 'pool' | 'cli-pipe'
console.log(listProfiles());
```

### Node client

```ts
import { decompress } from 'openzl-express';

const res = await fetch(url, { headers: { 'Accept-Encoding': 'openzl, gzip' } });
let buf = Buffer.from(await res.arrayBuffer());
if (res.headers.get('content-encoding') === 'openzl') {
  buf = await decompress(buf);
}
```

### Browser client

```js
import { createOpenZLFetch } from 'openzl-express/browser/fetch-openzl.js';
// after: npm run build:wasm  (needs Emscripten; wasm64)

const fetchOzl = await createOpenZLFetch();
const res = await fetchOzl('/api/data', {
  headers: { 'Accept-Encoding': 'openzl, gzip' }
});
```

Always keep **gzip** in Accept-Encoding for clients without wasm64.

---

## Install & platforms

| Layer | Platforms (CI) | On missing |
|-------|----------------|------------|
| `@amirja811/openzl-cli` (`zli`) | darwin-arm64, darwin-x64, linux-x64, linux-arm64, **win32-x64** | gzip only |
| Native N-API prebuild | same matrix via GitHub Releases | CLI → gzip |
| WASM browser | build locally / ship `browser/dist` | gzip |

```bash
# Optional: local native build
git clone --depth 1 https://github.com/facebook/openzl.git openzl
npm run build:openzl && npm run build:native

# Optional: browser WASM
npm run build:wasm   # requires emcc
```

Env knobs:

| Variable | Effect |
|----------|--------|
| `OPENZL_NATIVE=0` | Force CLI/gzip (ignore addon) |
| `OPENZL_SKIP_NATIVE=1` | Skip install-time prebuild download |
| `OPENZL_POOL_SIZE=0` | Disable CLI worker pool |
| `OPENZL_NATIVE_URL` | Override prebuild download URL |

`postinstall` runs `scripts/install-native.mjs` and **never fails** the install.

---

## Middleware options

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Master switch |
| `threshold` | `1024` | Min body bytes to compress |
| `fallbackToGzip` | `true` | On OpenZL error |
| `profile` | `'serial'` | Shipped or builtin profile / `.zlc` path |
| `selectProfile` | — | `(req, body, size) => profileName` |
| `preferStreamGzip` | `true` | Prefer gzip stream for `sendFile` when both accepted |
| `filter` | compressible types | `(req, res) => boolean` |
| `debug` | `false` | Logs |
| `onError` | — | `(err, req, res) => void` |

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm test` | Middleware smoke tests |
| `npm run bench` | Full codec matrix |
| `npm run train:profiles` | Regenerate `profiles/*.zlc` |
| `npm run build:native` | Local N-API addon |
| `npm run build:wasm` | Browser decoder |

---

## Roadmap status

| Phase | Status | One-liner |
|-------|--------|-----------|
| 0 Baseline | done | Bench harness + zstd honesty |
| 1 Kill spawn | done | ~30 ms → ~3 ms (raw `zli` + pipes) |
| 2 Native | done | ~0.1–0.4 ms encode |
| 3 Profiles | done | Trained ratio wins on typed data |
| 4 WASM | done | Browser decode + amortization number |
| 5 Coverage | done | send / stream / sendFile |
| 6 Ship | done | Windows zli, native prebuilds CI, install chain |

See `ROADMAP.md`.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Always gzip | No `Accept-Encoding: openzl`, or no native/CLI |
| `X-OpenZL-Error` | OpenZL failed; gzip fallback used |
| No compression | Below `threshold` or `identity` |
| WASM won’t load | Need **wasm64** browser/Node; fall back to gzip |
| Native missing after install | No release prebuild for platform yet; CLI still works |

---

## Related

- [OpenZL](https://github.com/facebook/openzl) (Meta)
- [`@amirja811/openzl-cli`](https://www.npmjs.com/package/@amirja811/openzl-cli) — prebuilt `zli`

## Disclaimer

Unofficial community package. Not affiliated with Meta.

## License

MIT
