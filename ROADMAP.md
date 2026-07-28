# openzl-express — Roadmap

> **The goal:** build a complete, credible OpenZL compression stack for the web — encoder, wire negotiation, decoder — and learn the whole depth of it by building it.
>
> **Not the goal:** beating zstd. zstd is the reference baseline we measure against, not the enemy. "Competitive and honest" is the bar.

**Current position:** Phase 6 — done. Stack is shippable; iterate on prebuild coverage and WASM size.

---

## Status legend

`[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — Baseline truth

**Status:** `[x]`
**Size:** ~1 session
**Depends on:** nothing
**Done:** 2026-07-27 — report at `bench/results/baseline.md` (JSON twin: `baseline.json`)

Build a benchmark harness before changing any code. Without a baseline, every later phase is a vibe.

### Tasks
- [x] `bench/` harness with warmup, repeat runs, outlier handling
- [x] Corpus generators:
  - [x] A — repetitive API JSON (typical REST list endpoint)
  - [x] B — numeric time-series JSON (OpenZL's home turf)
  - [x] C — prose-heavy JSON (expect OpenZL to lose)
  - [x] D — compact JSON, short keys, few repeats
  - [x] E — size sweep: 1KB / 10KB / 100KB / 1MB (10MB via `npm run bench:full`)
  - [x] F — non-JSON binary, fixed-width records
- [x] Codec runners: gzip L1/L6/L9 · brotli L4/L11 · zstd L1/L3/L19 · openzl `serial`
- [x] Metrics: ratio, encode p50/p95/p99, decode p50/p99, CPU time, RSS delta
- [x] End-to-end HTTP: TTFB + total over simulated 3G / 50Mbps / LAN
- [x] Report table + crossover chart, committed to repo

### Phase 0 headline numbers (this machine)

Encode p50 / ratio at ~100KB — **openzl serial vs zstd L3**:

| Corpus | openzl enc p50 | zstd3 enc p50 | openzl ratio | zstd3 ratio |
|--------|---------------:|--------------:|-------------:|------------:|
| A api-list | ~30.6ms | ~0.10ms | 4.7% | 5.5% |
| B timeseries | ~30.1ms | ~0.24ms | 27.0% | 25.8% |
| C prose | ~28.5ms | ~0.08ms | 1.9% | 2.0% |
| D compact | ~29.0ms | ~0.27ms | 31.5% | 32.3% |
| F binary | ~29.1ms | ~0.34ms | 57.4% | 52.5% |

**Finding:** ratio is competitive with zstd on serial; **latency is ~100–300× worse** because every request pays process spawn + temp files (~28–31ms floor). Phase 1 exists to kill that floor.

```
npm run bench          # default matrix (A–F, size sweep to 1MB)
npm run bench:quick    # smoke (~10KB)
npm run bench:full     # + 10MB size point
```

### Learn
Benchmark methodology that doesn't lie to you — why ratio is meaningless without naming the corpus, why p99 beats mean on a server, warmup effects, JIT noise.

### Reach
A committed table stating exactly where the project stands today. Every later phase is measured against this file.

### Notes
- Node 24 ships zstd in core `zlib` (`require('zlib').zstdCompress`). Browsers accept `Content-Encoding: zstd` (Chrome 123+, Firefox 126+, Safari 18.4+). zstd is the honest baseline, not gzip.
- Local `zli` works: `./node_modules/.bin/zli --version` → `zstrong-cli version 0.1`.

---

## Phase 1 — Kill the spawn

**Status:** `[x]`
**Size:** ~2-3 sessions
**Depends on:** Phase 0 (need the baseline to prove the gain)
**Done:** 2026-07-27 — report at `bench/results/baseline.md` (Phase 0 frozen at `bench/results/phase0-baseline.md`)

### What actually cost ~30ms

Two stacked mistakes, not "compression is slow":

1. **Node launcher tax** — `node_modules/.bin/zli` is a Node script that `spawnSync`s the real binary (~25ms of Node startup per request).
2. **Temp-file I/O** — write input, read output on every call.

The native binary alone is ~1–3ms. Phase 1 fixes both.

### Tasks
- [x] **1a** — resolve *native* `zli` binary; pipe via `/dev/stdin` + `/dev/stdout` (temp files only on Windows)
- [x] **1b** — persistent worker pool:
  - [x] N long-lived Node workers (each job still one-shots native `zli` — CLI has no daemon mode)
  - [x] length-framed binary protocol over pipes (`src/core/protocol.ts`)
  - [x] free-list dispatch (better than pure RR under uneven load)
  - [x] health check (ping) + respawn with backoff on worker death
  - [x] graceful shutdown (`shutdownOpenZL()` + process signal hooks)
- [x] Re-run Phase 0 benchmarks, record the delta

### Implementation map

| Module | Role |
|--------|------|
| `src/core/cli-path.ts` | Find native binary, never the Node launcher |
| `src/core/pipe-runner.ts` | One-shot stdin/stdout (or temp files on win32) |
| `src/core/protocol.ts` | Length-framed IPC |
| `src/core/worker.ts` | Child process entry |
| `src/core/pool.ts` | Pool + singleton (`OPENZL_POOL_SIZE`, default 2; `0` = one-shot) |
| `src/core/engine.ts` | pool → one-shot pipe fallback |

### Phase 0 → Phase 1 delta (encode p50, openzl serial)

| Corpus | Phase 0 | Phase 1 | Speedup |
|--------|--------:|--------:|--------:|
| A api-list (~100KB) | 30.64ms | 3.29ms | **9.3×** |
| B timeseries | 30.09ms | 3.84ms | **7.8×** |
| C prose | 28.47ms | 3.46ms | **8.2×** |
| D compact | 28.98ms | 3.98ms | **7.3×** |
| E-1kb | 27.69ms | 2.37ms | **11.7×** |
| E-1mb | 34.37ms | 9.65ms | **3.6×** |
| F binary | 29.09ms | 3.85ms | **7.6×** |

Ratio unchanged (still serial profile). Decode p50 dropped the same way (~28ms → ~2.5–3ms).

**Remaining gap vs zstd L3:** ~3ms vs ~0.1–0.3ms — that is process spawn of the native binary per job. Phase 2 (in-process N-API) kills that floor.

### Learn
Process lifecycle, framing protocols (why a pipe needs a length prefix), backpressure, pool saturation, recovering from a worker that dies mid-request. Also: always measure the *real* binary path, not the npm bin shim.

### Reach
~30ms → ~3ms encode p50. **Hit.** Biggest single number change in the project so far.

---

## Phase 2 — Native bindings

**Status:** `[x]`
**Size:** ~3-4 sessions — hardest phase, real C++
**Depends on:** Phase 1
**Done:** 2026-07-27 — report at `bench/results/baseline.md` (Phase 1 frozen at `bench/results/phase1-baseline.md`)

### Tasks
- [x] N-API addon wrapping `libopenzl` (`node-addon-api` + `cmake-js`)
- [x] Zero-copy `Buffer` in (Persistent ref during async work) / fresh `Buffer` out
- [x] Run on the libuv threadpool — `Napi::AsyncWorker` (does not block the event loop)
- [x] Fallback chain: native addon → worker pool → CLI pipe → (gzip at middleware)
- [x] Re-run benchmarks

### Implementation map

| Path | Role |
|------|------|
| `native/src/binding.cpp` | N-API: compress/decompress async + sync |
| `native/CMakeLists.txt` | Links static `libopenzl.a` + zstd + lz4 |
| `scripts/build-openzl.sh` | CMake-builds OpenZL library only |
| `scripts/build-native.sh` | `cmake-js compile` of the addon |
| `src/core/native.ts` | Optional loader (never throws on import) |
| `src/core/engine.ts` | native → pool → CLI |

```
npm run build:openzl   # needs ./openzl clone of facebook/openzl
npm run build:native   # → native/build/Release/openzl_native.node
```

Env: `OPENZL_NATIVE=0` forces CLI path (ignore addon).

### Phase 1 → Phase 2 delta (encode p50, openzl serial)

| Corpus | Phase 1 (CLI) | Phase 2 (native) | Speedup |
|--------|--------------:|-----------------:|--------:|
| A api-list (~100KB) | 3.29ms | **0.19ms** | **17×** |
| B timeseries | 3.84ms | **0.26ms** | **15×** |
| C prose | 3.46ms | **0.07ms** | **49×** |
| D compact | 3.98ms | **0.41ms** | **10×** |
| E-1kb | 2.37ms | **0.024ms** | **99×** |
| E-1mb | 9.65ms | **1.12ms** | **8.6×** |
| F binary | 3.85ms | **0.15ms** | **26×** |

vs **zstd L3** on ~100KB: openzl is now in the **same latency class** (often within 2×, sometimes faster on decode-bound shapes). Ratio still serial-only — Phase 3 is the ratio story.

**vs Phase 0 (spawn+temp):** ~30ms → ~0.2ms ≈ **150×** on corpus A.

### Notes / caveats
- Serial profile built in-process mirrors CLI intent (`ACE+LZ` + serial segmenter). Absolute ratios can differ slightly from the prebuilt `zli` binary if library versions diverge.
- **Frame version skew:** frames produced by native (current OpenZL sources, format ≤27) may not decompress with an older prebuilt `zli`. CLI→native decompress works; keep encoder/decoder versions matched for wire traffic.
- Addon is **optional** — without it, engine falls back to Phase 1 CLI path automatically.
- Distribution of prebuilds is Phase 6; today local `npm run build:native` after cloning OpenZL.

### Learn
N-API and node-addon-api, ABI stability across Node versions, the libuv threadpool, zero-copy buffer semantics, why "async addon" ≠ "fast addon".

### Reach
~0.1–0.5ms on typical JSON. **Hit.** Same latency class as zlib/zstd.

---

## Phase 3 — Trained profiles (the actual point)

**Status:** `[x]`
**Size:** ~3-5 sessions — most interesting phase
**Depends on:** Phase 0 (can run in parallel with 1 and 2)
**Done:** 2026-07-27 — report at `bench/results/phase3-profiles.md`

### Tasks
- [x] Remove hardcoded `serial`, make profile configurable (`CompressOptions.profile`)
- [x] Training pipeline: `npm run train:profiles` → sample corpora → `zli train` → `.zlc`
- [x] Ship trained profiles as assets (`profiles/*.zlc` + `manifest.json`)
- [x] Profile selection per route / per content shape (`middleware.selectProfile`, `suggestProfile`)
- [x] Benchmark trained vs serial across corpora A–F

### Implementation map

| Path | Role |
|------|------|
| `src/core/profiles.ts` | Resolve manifest / builtin / `.zlc` path |
| `src/core/pipe-runner.ts` | CLI `-p` and `-c` |
| `src/core/engine.ts` | `compress(buf, { profile })` |
| `src/middleware.ts` | `profile` + `selectProfile` + `X-OpenZL-Profile` |
| `profiles/manifest.json` | Catalog of shipped compressors |
| `scripts/train-profiles.mjs` | Regenerate `.zlc` assets |

```
npm run train:profiles
compress(buf, { profile: 'timeseries' })
openzlMiddleware({ profile: 'api-list' })
openzlMiddleware({
  selectProfile: (req) => req.path.startsWith('/metrics') ? 'timeseries' : 'serial'
})
```

### Ratio findings (~100KB, trained via CLI)

| Corpus | gzip6 | zstd3 | openzl serial | openzl trained | Train win |
|--------|------:|------:|--------------:|---------------:|----------:|
| A api-list | 6.0% | 5.5% | 9.0%* | **4.7%** (api-list) | large |
| B timeseries | 26.3% | 25.8% | 25.6% | **23.8%** (timeseries) | ~7% |
| C prose | 2.9% | 2.0% | 3.5% | **2.1%** (prose) | meaningful |
| F binary records | 62.9% | 52.5% | 64.7% | **13.8%** (binary) | **huge** |

\* serial on native path can differ from CLI serial when OpenZL versions diverge — train/ship with the encoder you deploy.

**The asymmetry is the finding:** typed/binary + trained graph wins hard; generic prose/API often only ties or edges out. Position the library there.

### Notes
- Trained compressors currently compress via **CLI `-c`** (not native deserialize yet — version/bundle constraints). Default `serial` still uses native for latency.
- Decompress is universal (frame embeds graph) — clients need a matching OpenZL decoder version, not the training profile name.
- Re-train when sample shape drifts: `npm run train:profiles`.

### Learn
What OpenZL actually **is**. Compression graphs, ACE training, why fixed-width numeric columns crush serial entropy coding.

### Reach
**Hit.** Real ratio wins on timeseries + binary; honest ties/losses elsewhere.

---

## Phase 4 — Browser decoder (WASM)

**Status:** `[x]`
**Size:** ~3-4 sessions
**Depends on:** Phase 3 (decode must match the profiles you ship)
**Done:** 2026-07-28 — artifacts in `browser/`, report `bench/results/phase4-wasm.md`

### Tasks
- [x] Emscripten build of `libopenzl` for **wasm64** (OpenZL requires 64-bit `size_t`)
- [x] Link decode glue + LTO/`-O3` (`scripts/build-wasm.sh`) → ~**1.3 MB** `.wasm`
- [x] `fetch` wrapper (`browser/fetch-openzl.js`)
- [x] Optional Service Worker (`browser/sw-openzl.js`)
- [x] Amortization calculator (`amortization()` + `browser/amortization.html`)
- [x] Measure decode p50 on Node (main-thread class number)

### Implementation map

| Path | Role |
|------|------|
| `wasm/src/openzl_decode.c` | C glue: get size + decompress |
| `scripts/build-wasm.sh` | emcmake openzl + emcc link |
| `browser/dist/openzl_decode.{js,wasm}` | Built module |
| `browser/openzl-decoder.js` | `createDecoder()`, amortization |
| `browser/fetch-openzl.js` | Auto-decode fetch |
| `browser/sw-openzl.js` | SW interception |

```bash
brew install emscripten   # once
npm run build:wasm
node browser/test-decode.mjs /path/to/file.zl
```

### Hard numbers (this machine)

| Metric | Value |
|--------|------:|
| `openzl_decode.wasm` | **~1.39 MB** |
| Decode p50 (~29 KB JSON → 1.6 KB openzl) | **~0.04 ms** (Node) |
| Break-even vs gzip (same payload) | **~1.6k responses/session** before WASM download pays for itself on transfer alone |

**Finding (legitimate, not a failure):** for small API responses the WASM tax dominates. OpenZL on the web is a win for **large / many typed payloads per session** (or when you already ship the decoder for another reason). Prefer gzip for one-off tiny pages.

### Caveats
- **wasm64 / MEMORY64 required** — not all browsers yet. Clients without it must negotiate gzip only.
- Full `libopenzl` is linked (encode sources still in the archive); pure decode-only DCE of the CMake graph is future work. LTO already trims a lot (archive 18 MB → wasm 1.3 MB).
- Frame version must match the OpenZL revision used to build the WASM (same as native encode skew).

### Learn
Emscripten, wasm64 vs wasm32, why OpenZL cannot run on classic wasm32 without deep patches.

### Reach
**Hit.** Usable open-web decoder + honest amortization number.

---

## Phase 5 — Coverage parity

**Status:** `[x]`
**Size:** ~2 sessions
**Depends on:** Phase 1
**Done:** 2026-07-28 — `src/middleware.ts` rewrite; smoke: `npm test`

### Tasks
- [x] Wrap `res.send` / `res.json` via shared `write`/`end` hooks
- [x] Streaming gzip via `zlib.createGzip` Transform (real TTFB win)
- [x] `sendFile` / static: pipe → gzip stream, or full-file OpenZL when openzl-only
- [x] OpenZL still buffers (no stream encoder) — document + `preferStreamGzip` default

### Behavior

| Path | gzip client | openzl client | openzl+gzip client |
|------|-------------|---------------|--------------------|
| `res.json` / `res.send` | gzip stream | buffer → openzl | openzl buffer |
| multi `write` stream | gzip stream | buffer → openzl | openzl buffer |
| `res.sendFile` | gzip stream | buffer → openzl | **gzip stream** if `preferStreamGzip` (default) |

Options: `filter`, `preferStreamGzip` (default `true`).

```bash
npm test   # scripts/test-middleware.mjs
```

### Honest limit
OpenZL encode is still whole-message (native/CLI). **Gzip is the streaming path.** That matches engine reality and is better than lying about openzl TTFB.

### Learn
Node streams, Transform, backpressure, why full-body openzl cannot beat gzip on TTFB for pipes.

### Reach
**Hit** for drop-in coverage vs `compression` for common Express responses. Not a 1:1 stream openzl encoder.

---

## Phase 6 — Ship it

**Status:** `[x]`
**Size:** ~2 sessions
**Depends on:** Phase 2
**Done:** 2026-07-28 · package `0.3.0`

### Tasks
- [x] CI prebuild matrix for **native** N-API (platform × arch; N-API = ABI-stable across Node 18+)
- [x] Add **Windows** to `zli` CLI matrix (`win32-x64`) + native best-effort
- [x] Install-time download + runtime fallback: prebuild → CLI → gzip (`scripts/install-native.mjs`)
- [x] README rewritten around real measured numbers — wins **and** losses

### Workflows

| Workflow | Role |
|----------|------|
| `build-binaries.yml` | `zli` for darwin-arm64/x64, linux-x64/arm64, **win32-x64** → npm `@amirja811/openzl-cli` |
| `build-native.yml` | `openzl_native.node` per platform → GitHub Release assets |
| `ci.yml` | `npm test` on Node 18/20/22 × ubuntu/macOS |
| `publish-express.yml` | `openzl-express` on GitHub Release |

### Fallback chain (install + runtime)

```
prebuilds/{platform}-{arch}/openzl_native.node
  → @amirja811/openzl-cli (zli)
  → gzip (always)
  → identity
```

`postinstall` never fails the install.

### Learn
Native distribution: N-API stability, optionalDependencies, non-fatal install scripts, CI matrix reality (Windows is the painful one).

### Reach
**Hit** for “stranger can `npm install` and get a working middleware.” Peak native/WASM still optional extras.

---

## End state

**A three-layer stack**
- Node native encoder (~0.1–0.4 ms) with worker-pool → CLI → gzip fallbacks beneath it
- Clean HTTP negotiation (`src/core/negotiate.ts`)
- Decoders for Node and browser (WASM ~1.3 MB, wasm64)

**Benchmark reports** in `bench/results/` — corpora, codecs, wins and losses.

**Positioning line (earned):**
> Better ratio for shape-matched / typed payloads when you train. Competitive latency with native encode. Opt-in clients.

Not a gzip replacement. Doesn't need to be.

**Ship path:** `npm install openzl-express@0.3.0` — works with gzip alone; OpenZL unlocks with optional CLI + native prebuilds.

**Skills banked:** N-API, WASM/Emscripten, Node streams, worker protocols, compression graphs, benchmark methodology, native distribution.

---

## What's already good — don't break it

`src/core/negotiate.ts` and the negotiation half of `src/middleware.ts` are solid:

- q-value parsing correct, `q=0` rejection correct (`negotiate.ts:31`)
- `openzl` only from an explicit token — `*` maps to gzip only (`negotiate.ts:66-77`) — prevents shipping undecodable bytes to browsers
- `Vary: Accept-Encoding` set (`middleware.ts:56`) — CDN-safe
- Fallback re-negotiates with `allowOpenZL: false` (`middleware.ts:123-126`) — correct

---

## Rules for the journey

1. **Phase 0 first, always.** No baseline = no proof.
2. **Re-run benchmarks after every phase.** Record the delta in this file.
3. **Report losses.** A corpus where OpenZL loses is a finding, not a bug to hide.
4. **zstd stays in every benchmark.** It's the honest bar.
5. **Update `Current position` at the top** when a phase starts or finishes.
