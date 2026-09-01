# openzl-express

**HTTP compression for Node.js** — **gzip**, **brotli**, and **zstd** by default.
Optional **[OpenZL](https://github.com/facebook/openzl)** when you train on shaped data and the client opts in.

[![npm version](https://img.shields.io/npm/v/openzl-express.svg)](https://www.npmjs.com/package/openzl-express)
[![Node.js](https://img.shields.io/node/v/openzl-express.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```bash
npm install openzl-express
```

Works with **Express**, **Fastify**, or **no framework** (`openzl-express/core`),
from both **ESM** (`import`) and **CommonJS** (`require`).

Most people should use it as ordinary HTTP compression — gzip, brotli, zstd —
the same way they use the `compression` package. OpenZL is a second step,
only after you measure it on your own payloads.

Replacing `compression` or `@fastify/compress`? Start here: **[docs/MIGRATION.md](docs/MIGRATION.md)**.
You do not need OpenZL for that path.

---

## Why this exists

| Codec | Role |
|-------|------|
| **gzip** | Always available. Safe default. Browser-friendly. |
| **br** (brotli) | Every browser sends it. Smaller *and* faster than gzip at the default quality. |
| **zstd** | Fastest of the general codecs when Node supports it (typically Node ≥ 22.15). |
| **openzl** | **Opt-in only.** Best on *shaped* data (metrics JSON, fixed binary) after training. |

Negotiation order when a client accepts several: **openzl → zstd → br → gzip**
(equal q-values; a higher q always wins, and each codec can be switched off).

Measured on a 188 KB JSON list response, Node 24 / M-series:

| Codec | Output | Ratio | Encode |
|-------|--------|-------|--------|
| gzip | 37.6 KB | 19.9% | 1.86 ms |
| **br** (quality 4, default) | **32.5 KB** | **17.2%** | **1.14 ms** |
| zstd | 33.6 KB | 17.8% | 0.52 ms |
| openzl (`serial`) | 35.7 KB | 18.9% | 0.39 ms |
| br quality 11 | 23.6 KB | 12.5% | 181.8 ms ⚠️ |

Brotli's zlib default is quality **11** — meant for build-time precompression of
static files, 160× slower here. This package defaults to **quality 4**, which on
this payload beat gzip on both size and speed. Tune with `brotliQuality`.

**Design rules (same as production compression packages):**

- `Accept-Encoding: *` → **gzip** (never openzl, zstd, or br by default)
- Clients must send **`openzl` explicitly** to get OpenZL
- Missing OpenZL CLI/native → **install still succeeds**; gzip/br/zstd keep working
- `Vary: Accept-Encoding` is **appended** (existing `Vary: Origin` from cors survives)
- `Cache-Control: no-transform` responses are never re-encoded (RFC 9110)
- `206 Partial Content` is never re-encoded — the range describes the identity bytes — and neither are 204/205/304
- `HEAD` advertises the same `Content-Encoding` a `GET` would return, when the declared length makes that knowable
- Bodies below `threshold` pass through untouched on every codec path
- Streaming respects backpressure end to end — a slow client throttles the producer instead of filling server memory
- A codec failure ends the response (500, or connection close mid-body) rather than leaving the client waiting

OpenZL is **not** “always better” — on the JSON above it lost to brotli and zstd.
It earns its place on *shaped* data after training. Measure on *your* payloads.

### 1.0 guarantees

- `openzl` is **never** chosen for `Accept-Encoding: *`
- `debugHeaders` default **off**
- Browser WASM is **experimental** (`openzl-express/browser`)
- Missing OpenZL native/CLI **does not fail install**; gzip/br/zstd keep working
- Native OpenZL prebuilds: **linux-x64, linux-arm64, darwin-arm64** only (see table below)

---

## Install

```bash
npm install openzl-express
```

**Peer (optional):** install the framework you use.

```bash
npm install express    # and/or
npm install fastify
```

**Optional OpenZL encode backend:**

```bash
npm install @amirja811/openzl-cli   # prebuilt `zli` when available for your platform
```

| Requirement | Version |
|-------------|---------|
| Node | **≥ 18** |
| gzip + brotli via `zlib` | built in on every supported Node — no extra deps |
| zstd via `zlib` | typically **≥ 22.15** (auto-skipped if missing) |
| OpenZL encode | native prebuild and/or `zli` CLI (optional) |

**OpenZL native addon availability.** gzip, brotli, and zstd work everywhere and
need none of this — the table below is only about the optional OpenZL encoder.
The npm tarball ships no binaries; `postinstall` fetches the one matching your
platform from the matching GitHub Release, and silently falls back to the `zli`
CLI or gzip/br/zstd if it cannot.

| Platform | OpenZL native |
|----------|---------------|
| linux-x64 / linux-arm64 (glibc) | prebuild published |
| darwin-arm64 | prebuild published |
| darwin-x64 (Intel Mac) | not published — CI cannot allocate an Intel macOS runner; build locally |
| linux musl (Alpine) | not published — build locally (`npm run build:native`) |
| win32 | **not available**: OpenZL's C sources do not compile under MSVC yet |

Offline or firewalled installs get no addon (by design, never fatal). Force a
specific binary with `OPENZL_NATIVE_URL`, skip the step with
`OPENZL_SKIP_NATIVE=1`, or build from source with `npm run build:native`.

---

## Module formats

Ships ESM and CommonJS builds from one package; every entry point works with
either syntax, with matching TypeScript types under `moduleResolution: node16`.

```js
// ESM
import { openzlMiddleware } from 'openzl-express/express';

// CommonJS
const { openzlMiddleware } = require('openzl-express/express');
```

The two builds are **not bundled**, so all entry points share a single
`core` instance — one OpenZL CLI process pool and one native-addon cache, not
one per entry point.

> Standard dual-package caveat: loading *both* the ESM and CJS copies in the
> same process (say, `import` in your code and `require` from a dependency)
> gives you two independent module states, and therefore two CLI pools. Pick one
> syntax per process if you use the OpenZL backend.

---

## 30-second start

### Express

```ts
import express from 'express';
import { openzlMiddleware } from 'openzl-express/express';

const app = express();

app.use(
  openzlMiddleware({
    threshold: 1024,          // skip bodies smaller than this
  })
);

app.get('/api/metrics', (_req, res) => {
  res.json({ points: [/* … */] });
});

app.listen(3000);
```

### Fastify

```ts
import Fastify from 'fastify';
import { openzlFastify } from 'openzl-express/fastify';

const app = Fastify();
await app.register(openzlFastify, { threshold: 1024 });
// gzip/br/zstd stream when you `reply.send` a Node Readable.
// JSON/string bodies are compressed after they are fully produced.
app.get('/api/data', async () => ({ ok: true, items: [] }));
await app.listen({ port: 3000 });
```

### Core only (no HTTP framework)

```ts
import {
  compress,
  decompress,
  compressGzip,
  compressBrotli,
  compressZstd,
  pickEncoding,
  isZstdAvailable,
} from 'openzl-express/core';

const buf = Buffer.from(JSON.stringify({ hello: 'world' }));

// What would the server pick?
pickEncoding('openzl, zstd, gzip');    // → 'openzl'
pickEncoding('gzip, deflate, br');     // → 'br'
pickEncoding('gzip, deflate, br, zstd'); // → 'zstd'
pickEncoding('*');                     // → 'gzip'

const gz = await compressGzip(buf);
const zl = await compress(buf, { profile: 'serial' }); // needs openzl backend
const raw = await decompress(zl);
```

---

## How users test it (copy-paste)

### 1) Gzip path (always works)

```bash
# terminal 1
node -e "
import express from 'express';
import { openzlMiddleware } from 'openzl-express/express';
const app = express();
app.use(openzlMiddleware({ threshold: 100 }));
app.get('/t', (_, res) => res.json({ items: Array.from({length: 200}, (_,i)=>({id:i,name:'x'+i})) }));
app.listen(3456, () => console.log('http://127.0.0.1:3456/t'));
"

# terminal 2
curl -sD- -H 'Accept-Encoding: gzip' http://127.0.0.1:3456/t -o /tmp/t.gz | grep -i content-encoding
# expect: content-encoding: gzip
```

### 2) Brotli path (what a real browser gets)

```bash
curl -sD- -H 'Accept-Encoding: gzip, deflate, br, zstd' http://127.0.0.1:3456/t -o /tmp/t.br | grep -i content-encoding
# expect: content-encoding: zstd   (br when the Node build has no zstd)

curl -sD- -H 'Accept-Encoding: gzip, deflate, br' http://127.0.0.1:3456/t -o /tmp/t.br | grep -i content-encoding
# expect: content-encoding: br
```

### 3) Zstd path (Node with zlib zstd)

```bash
curl -sD- -H 'Accept-Encoding: zstd' http://127.0.0.1:3456/t -o /tmp/t.zst | grep -i content-encoding
# expect: content-encoding: zstd   (or gzip if zstd unavailable)
```

### 4) OpenZL path (needs CLI or native)

```bash
curl -sD- -H 'Accept-Encoding: openzl' http://127.0.0.1:3456/t -o /tmp/t.zl | grep -i content-encoding
# expect: content-encoding: openzl
```

`X-OpenZL-Profile` / `X-OpenZL-Ratio` are off by default; start the server with
`openzlMiddleware({ debugHeaders: true })` to see them while tuning profiles.

### 5) Decode OpenZL in Node

Hand-rolled:

```ts
import { decompress } from 'openzl-express';
import fs from 'fs';

const frame = fs.readFileSync('/tmp/t.zl');
const plain = await decompress(frame);
console.log(JSON.parse(plain.toString()));
```

Or wrap `fetch` so a Node client opts in and inflates OpenZL for you (gzip/br/zstd stay with the runtime):

```ts
import { createOpenZLFetch } from 'openzl-express/core';

const fetchZ = createOpenZLFetch();
const res = await fetchZ('http://127.0.0.1:3456/api/metrics');
const json = await res.json();
```

### 6) Compare sizes (your role models: gzip, br & zstd)

```ts
import {
  compress,
  compressGzip,
  compressBrotli,
  compressZstd,
  isZstdAvailable,
} from 'openzl-express';

const plain = Buffer.from(JSON.stringify(payload));
const gz = await compressGzip(plain);
const br = await compressBrotli(plain);            // quality 4 by default
const zs = isZstdAvailable() ? await compressZstd(plain) : null;
const oz = await compress(plain, { profile: 'timeseries' });

console.table({
  plain: plain.length,
  gzip: gz.length,
  br: br.length,
  zstd: zs?.length ?? 'n/a',
  openzl: oz.length,
});
// Keep openzl only if it wins (or ties with a clear reason).
```

### 7) Live demo in this repo

```bash
git clone https://github.com/alvinja81/openzl-npm.git
cd openzl-npm && npm install && npm run demo:flagship
# open http://127.0.0.1:3456/
```

---

## Content negotiation

| Client sends `Accept-Encoding` | Server may respond |
|--------------------------------|--------------------|
| `openzl` (explicit) | `Content-Encoding: openzl` |
| `zstd` | `zstd` (if runtime supports it) |
| `br` | `br` |
| `gzip` or `*` | `gzip` |
| `gzip, deflate, br` (typical browser) | `br` |
| `gzip, deflate, br, zstd` (Chrome ≥ 123) | `zstd` |
| `openzl, zstd, br, gzip` | prefers **openzl** → zstd → br → gzip |
| `br;q=0.5, gzip` | `gzip` — a higher q always beats the default order |
| none | uncompressed |

Browsers almost never send `openzl`, so they get **br/zstd/gzip** only.

---

## Package entry points

| Import | Use when |
|--------|----------|
| `openzl-express` | Default / back-compat (Express + core re-exports) |
| `openzl-express/express` | Express middleware only |
| `openzl-express/fastify` | Fastify plugin |
| `openzl-express/core` | Framework-free compress / negotiate |
| `openzl-express/browser` | **Experimental** WASM decode (not recommended for public web) |

---

## Middleware options

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Master switch |
| `threshold` | `1024` | Minimum body size (bytes) to compress. Enforced on all paths: responses buffer until the threshold is crossed, then switch to streaming compression (below it, bodies pass through untouched). |
| `profile` | `'serial'` | OpenZL profile name or path to `.zlc` |
| `selectProfile` | — | `(req, …) => profile` per request |
| `fallbackToGzip` | `true` | On OpenZL failure, re-negotiate to zstd/br/gzip. `false` sends the body uncompressed instead |
| `preferStreamGzip` | `true` | Prefer streaming gzip/br/zstd for Express `sendFile` and Fastify `Readable` payloads when OpenZL was negotiated |
| `allowZstd` | auto | Set `false` to disable zstd |
| `allowBrotli` | auto | Set `false` to disable brotli |
| `brotliQuality` | `4` | Brotli quality 0–11. Raise only for cacheable responses — 11 is ~160× slower |
| `zstdLevel` | zlib default | Zstd compression level |
| `onCompress` | — | Metrics: `{ encoding, ratio, ms, bytesIn, bytesOut }` |
| `debugHeaders` | `false` | Emit `X-OpenZL-Profile`, `X-OpenZL-Ratio`, `X-Original-Size`, … Off by default: they cost bytes on every compressed response and disclose the uncompressed size |
| `onError` | — | Error hook |
| `filter` | compressible types | `(req, res) => boolean` |
| `debug` | `false` | Verbose logs |

**Shipped profiles:** `serial`, `timeseries`, `api-list`, `prose`, `binary`, `binary-le-u32`, `binary-sddl`  
See `profiles/manifest.json` after install.

---

## Train on your data

```bash
# 10–20 real response bodies in ./samples/
npx openzl-train ./samples -o ./my-metrics.zlc -p serial --max-time 40
```

```ts
app.use(openzlMiddleware({
  profile: './my-metrics.zlc',
  // or only for one route family:
  selectProfile: (req) =>
    req.path.startsWith('/api/metrics') ? './my-metrics.zlc' : 'serial',
}));
```

`openzl-train` then prints a gzip / br / zstd / openzl table on a held-out file and a verdict (`enable` or `keep-heroes`). Pass `--strict` to exit 2 when OpenZL loses.

**Pass/fail rule:** if openzl is larger than zstd/br (or gzip when those are missing) on held-out samples, **don’t enable openzl** for that route.

---

## Benchmarks (honest)

~100 KB held-out corpora · gzip L6 · zstd L3 · OpenZL **trained** · lower % = smaller:

| Corpus | gzip | zstd | openzl trained |
|--------|-----:|-----:|---------------:|
| API list JSON | 6.0% | 5.5% | **4.7%** |
| Timeseries JSON | 26.3% | 25.8% | **23.8%** |
| Prose JSON | 2.9% | **2.0%** | 2.1% |
| Binary records | 62.9% | 52.5% | **13.8%** → **6.4%** (SDDL) |

Encode with native addon is typically **~0.1–0.4 ms** for ~100 KB (same class as zstd L3).

Charts and full reports: [GitHub `docs/charts`](https://github.com/alvinja81/openzl-npm/tree/main/docs/charts) · [`bench/results`](https://github.com/alvinja81/openzl-npm/tree/main/bench/results)

---

## Safety & observability

```ts
import { decompress, LimitError } from 'openzl-express';

try {
  await decompress(frame, {
    maxInputBytes: 64 * 1024 * 1024,   // default
    maxOutputBytes: 256 * 1024 * 1024, // default
    timeoutMs: 30_000,
  });
} catch (e) {
  if (e instanceof LimitError) {
    // INPUT_TOO_LARGE | OUTPUT_TOO_LARGE | TIMEOUT
  }
}
```

```ts
openzlMiddleware({
  onCompress: ({ encoding, ratio, ms, bytesIn, bytesOut }) => {
    // wire to your metrics system
  },
});
```

---

## Environment variables

| Variable | Effect |
|----------|--------|
| `OPENZL_SKIP_NATIVE=1` | Skip native download on install |
| `OPENZL_NATIVE=0` | Ignore native addon at runtime |
| `OPENZL_POOL_SIZE=0` | Disable CLI worker pool |
| `OPENZL_DEBUG=1` | Log fallback paths |

---

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Always gzip | Client didn’t send `openzl`; or no CLI/native installed |
| No zstd | Node build without zlib zstd → package skips zstd automatically |
| `npm install` ok but no openzl | Expected without CLI/native — heroes still work |
| Browser can’t decode openzl | Don’t send `openzl` to browsers; use br/zstd/gzip |

---

## Docs

| Doc | Topic |
|-----|--------|
| [docs/MIGRATION.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/MIGRATION.md) | Replace `compression` / `@fastify/compress` |
| [docs/FLAGSHIP.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/FLAGSHIP.md) | Metrics / timeseries use case |
| [docs/CASE-STUDY.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/CASE-STUDY.md) | Measured corpora + production checklist |
| [docs/COMPAT.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/COMPAT.md) | Errors, limits, frame compatibility |
| [docs/BROWSER.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/BROWSER.md) | Why browser WASM is experimental |
| [docs/RELEASE.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/RELEASE.md) | Maintainers: release process |
| [SECURITY.md](https://github.com/alvinja81/openzl-npm/blob/main/SECURITY.md) | Vulnerability reporting |
| [CONTRIBUTING.md](https://github.com/alvinja81/openzl-npm/blob/main/CONTRIBUTING.md) | Contributing |

---

## License

MIT

**Disclaimer:** Unofficial community package. Not affiliated with Meta.
