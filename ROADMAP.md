# openzl-express — Roadmap

> **The goal:** build a complete, credible OpenZL compression stack for the web — encoder, wire negotiation, decoder — and learn the whole depth of it by building it.
>
> **Not the goal:** beating zstd. zstd is the reference baseline we measure against, not the enemy. "Competitive and honest" is the bar.

**Current position:** Phase 3 — done. Next: Phase 4 (WASM decoder) or Phase 5 (coverage parity).

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

**Status:** `[ ]`
**Size:** ~3-4 sessions
**Depends on:** Phase 3 (decode must match the profiles you ship)

The real wall: gzip has a decoder in every browser on earth. OpenZL has none. You have to ship it.

### Tasks
- [ ] Emscripten build of `libopenzl`, **decode path only** (no encode — halves the binary)
- [ ] Dead-code elimination pass to shrink output
- [ ] `fetch` wrapper for transparent decode
- [ ] Optional Service Worker for zero-app-code integration
- [ ] Amortization calculator: `wasm_bytes + Σ openzl_bytes < Σ gzip_bytes`
- [ ] Measure main-thread block time vs native browser gzip/zstd (which decode off-thread, free)

### Learn
Emscripten, the WASM memory model, binary size reduction, Service Worker fetch interception, streaming decode in a browser.

### Reach
OpenZL becomes usable on the open web — plus a hard number on when it's worth it. If that number says "only above 5MB/session," that is a legitimate result, not a failure. Write it down either way.

---

## Phase 5 — Coverage parity

**Status:** `[ ]`
**Size:** ~2 sessions
**Depends on:** Phase 1

Middleware only wraps `res.json` (`src/middleware.ts:46`). `res.send`, `res.write`/streaming, `sendFile`, and static files all bypass compression. The `compression` package covers all of them — coverage gap is an adoption gap.

### Tasks
- [ ] Wrap `res.send`
- [ ] Streaming compression via a Transform stream
- [ ] Static file / `sendFile` support
- [ ] Fix whole-body buffering (currently destroys TTFB on large responses)

### Learn
Node streams properly — Transform, backpressure, why buffering the full body kills TTFB, how `compression` hooks Express internals.

### Reach
Drop-in replaceable for `compression`. Adoption becomes possible.

---

## Phase 6 — Ship it

**Status:** `[ ]`
**Size:** ~2 sessions
**Depends on:** Phase 2

### Tasks
- [ ] CI prebuild matrix: platform × Node ABI
- [ ] Add Windows (CI already builds macOS arm64/x64 + Linux x64/arm64)
- [ ] `prebuild-install` with full fallback chain
- [ ] README rewritten around real measured numbers — wins **and** losses

### Learn
Native module distribution — one of the harder unglamorous problems in the Node ecosystem.

### Reach
Something a stranger can `npm install` and have work.

---

## End state

**A three-layer stack**
- Node native encoder (~0.1-0.5ms) with worker-pool → CLI → gzip fallbacks beneath it
- Clean HTTP negotiation (`src/core/negotiate.ts` — already the strongest code here, mostly untouched)
- Decoders for both Node and browser

**A benchmark report** — six corpora, four codecs (gzip · brotli · zstd · openzl; multiple levels each), wins and losses reported honestly.

**A positioning line that was earned:**
> Better ratio for typed/numeric payloads. Competitive latency. Opt-in clients.

Not a gzip replacement. Doesn't need to be.

**And the skills:** N-API, WASM/Emscripten, Node streams, worker protocols, compression graph theory, benchmark methodology, native distribution. That stack is worth more than the library.

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
