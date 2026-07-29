# openzl-express

**HTTP compression middleware for Node.js** — negotiate **gzip**, **zstd**, and optional **[OpenZL](https://github.com/facebook/openzl)**.

[![npm version](https://img.shields.io/npm/v/openzl-express.svg)](https://www.npmjs.com/package/openzl-express)
[![Node.js](https://img.shields.io/node/v/openzl-express.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```bash
npm install openzl-express
```

Works with **Express**, **Fastify**, or **no framework** (`openzl-express/core`).

---

## Why this exists

| Codec | Role |
|-------|------|
| **gzip** | Always available. Safe default. Browser-friendly. |
| **zstd** | Modern default when Node supports it (typically Node ≥ 22.15). |
| **openzl** | **Opt-in only.** Best on *shaped* data (metrics JSON, fixed binary) after training. |

**Design rules (same as production compression packages):**

- `Accept-Encoding: *` → **gzip** (never openzl, never zstd by default)
- Clients must send **`openzl` explicitly** to get OpenZL
- Missing OpenZL CLI/native → **install still succeeds**; gzip/zstd keep working
- `Vary: Accept-Encoding` is set when middleware runs

This is **not** “always better than gzip.” Measure against gzip/zstd on *your* payloads.

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
| zstd via `zlib` | typically **≥ 22.15** (auto-skipped if missing) |
| OpenZL encode | native prebuild and/or `zli` CLI (optional) |

---

## 30-second start

### Express

```ts
import express from 'express';
import { openzlMiddleware } from 'openzl-express/express';

const app = express();

app.use(
  openzlMiddleware({
    threshold: 1024,          // skip tiny bodies
    profile: 'timeseries',    // or 'serial' | 'api-list' | path to .zlc
    fallbackToGzip: true,
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
await app.register(openzlFastify, { threshold: 1024, profile: 'serial' });
app.get('/api/data', async () => ({ ok: true, items: [] }));
await app.listen({ port: 3000 });
```

### Core only (no HTTP framework)

```ts
import {
  compress,
  decompress,
  compressGzip,
  compressZstd,
  pickEncoding,
  isZstdAvailable,
} from 'openzl-express/core';

const buf = Buffer.from(JSON.stringify({ hello: 'world' }));

// What would the server pick?
pickEncoding('openzl, zstd, gzip'); // → 'openzl'
pickEncoding('gzip, deflate, br');  // → 'gzip'
pickEncoding('*');                  // → 'gzip'

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

### 2) Zstd path (Node with zlib zstd)

```bash
curl -sD- -H 'Accept-Encoding: zstd' http://127.0.0.1:3456/t -o /tmp/t.zst | grep -i content-encoding
# expect: content-encoding: zstd   (or gzip if zstd unavailable)
```

### 3) OpenZL path (needs CLI or native)

```bash
curl -sD- -H 'Accept-Encoding: openzl' http://127.0.0.1:3456/t -o /tmp/t.zl | grep -iE 'content-encoding|x-openzl'
# expect: content-encoding: openzl
# optional: x-openzl-profile, x-openzl-ratio
```

### 4) Decode OpenZL in Node

```ts
import { decompress } from 'openzl-express';
import fs from 'fs';

const frame = fs.readFileSync('/tmp/t.zl');
const plain = await decompress(frame);
console.log(JSON.parse(plain.toString()));
```

### 5) Compare sizes (your role models: gzip & zstd)

```ts
import {
  compress,
  compressGzip,
  compressZstd,
  isZstdAvailable,
} from 'openzl-express';

const plain = Buffer.from(JSON.stringify(payload));
const gz = await compressGzip(plain);
const zs = isZstdAvailable() ? await compressZstd(plain) : null;
const oz = await compress(plain, { profile: 'timeseries' });

console.table({
  plain: plain.length,
  gzip: gz.length,
  zstd: zs?.length ?? 'n/a',
  openzl: oz.length,
});
// Keep openzl only if it wins (or ties with a clear reason).
```

### 6) Live demo in this repo

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
| `gzip` or `*` | `gzip` |
| `openzl, zstd, gzip` | prefers **openzl** → zstd → gzip |
| none | uncompressed |

Browsers almost never send `openzl`, so they get **gzip/zstd** only.

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
| `threshold` | `1024` | Minimum body size (bytes) to compress |
| `profile` | `'serial'` | OpenZL profile name or path to `.zlc` |
| `selectProfile` | — | `(req, …) => profile` per request |
| `fallbackToGzip` | `true` | On OpenZL failure, try gzip/zstd |
| `preferStreamGzip` | `true` | Prefer streaming gzip/zstd for `sendFile` |
| `allowZstd` | auto | Set `false` to disable zstd |
| `onCompress` | — | Metrics: `{ encoding, ratio, ms, bytesIn, bytesOut }` |
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

**Pass/fail rule:** if openzl is larger than zstd (or gzip when zstd is missing) on held-out samples, **don’t enable openzl** for that route.

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
| Browser can’t decode openzl | Don’t send `openzl` to browsers; use gzip/zstd |

---

## Docs

| Doc | Topic |
|-----|--------|
| [docs/FLAGSHIP.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/FLAGSHIP.md) | Metrics / timeseries use case |
| [docs/COMPAT.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/COMPAT.md) | Errors, limits, frame compatibility |
| [docs/BROWSER.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/BROWSER.md) | Why browser WASM is experimental |
| [docs/RELEASE.md](https://github.com/alvinja81/openzl-npm/blob/main/docs/RELEASE.md) | Maintainers: release process |
| [CONTRIBUTING.md](https://github.com/alvinja81/openzl-npm/blob/main/CONTRIBUTING.md) | Contributing |

---

## License

MIT

**Disclaimer:** Unofficial community package. Not affiliated with Meta.
