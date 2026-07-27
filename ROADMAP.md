# openzl-express — Roadmap

> **The goal:** build a complete, credible OpenZL compression stack for the web — encoder, wire negotiation, decoder — and learn the whole depth of it by building it.
>
> **Not the goal:** beating zstd. zstd is the reference baseline we measure against, not the enemy. "Competitive and honest" is the bar.

**Current position:** Phase 0 — not started.

---

## Status legend

`[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — Baseline truth

**Status:** `[ ]`
**Size:** ~1 session
**Depends on:** nothing

Build a benchmark harness before changing any code. Without a baseline, every later phase is a vibe.

### Tasks
- [ ] `bench/` harness with warmup, repeat runs, outlier handling
- [ ] Corpus generators:
  - [ ] A — repetitive API JSON (typical REST list endpoint)
  - [ ] B — numeric time-series JSON (OpenZL's home turf)
  - [ ] C — prose-heavy JSON (expect OpenZL to lose)
  - [ ] D — compact JSON, short keys, few repeats
  - [ ] E — size sweep: 1KB / 10KB / 100KB / 1MB / 10MB
  - [ ] F — non-JSON binary, fixed-width records
- [ ] Codec runners: gzip L1/L6/L9 · brotli L4/L11 · zstd L1/L3/L19 · openzl `serial`
- [ ] Metrics: ratio, encode p50/p95/p99, decode p50/p99, CPU time, RSS delta
- [ ] End-to-end HTTP: TTFB + total over simulated 3G / 50Mbps / LAN
- [ ] Report table + crossover chart, committed to repo

### Learn
Benchmark methodology that doesn't lie to you — why ratio is meaningless without naming the corpus, why p99 beats mean on a server, warmup effects, JIT noise.

### Reach
A committed table stating exactly where the project stands today. Every later phase is measured against this file.

### Notes
- Node 24 ships zstd in core `zlib` (`require('zlib').zstdCompress`). Browsers accept `Content-Encoding: zstd` (Chrome 123+, Firefox 126+, Safari 18.4+). zstd is the honest baseline, not gzip.
- Local `zli` works: `./node_modules/.bin/zli --version` → `zstrong-cli version 0.1`.

---

## Phase 1 — Kill the spawn

**Status:** `[ ]`
**Size:** ~2-3 sessions
**Depends on:** Phase 0 (need the baseline to prove the gain)

Current encoder forks a whole process and does two temp-file roundtrips **per HTTP response** — `src/core/engine.ts:99-117`. That fixed ~10-30ms cost (estimate — measure in Phase 0) dwarfs the actual compression work.

### Tasks
- [ ] **1a** — pipe via stdin/stdout, drop temp files entirely
- [ ] **1b** — persistent worker pool:
  - [ ] N long-lived `zli` processes
  - [ ] length-framed binary protocol over pipes
  - [ ] round-robin dispatch
  - [ ] health check + respawn on worker death
  - [ ] graceful shutdown
- [ ] Re-run Phase 0 benchmarks, record the delta

### Learn
Process lifecycle, framing protocols (why a pipe needs a length prefix), backpressure, pool saturation, recovering from a worker that dies mid-request.

### Reach
~10-30ms → ~1-3ms. Biggest single number change in the project. Crossover point vs zstd drops by an order of magnitude.

---

## Phase 2 — Native bindings

**Status:** `[ ]`
**Size:** ~3-4 sessions — hardest phase, real C++
**Depends on:** Phase 1

### Tasks
- [ ] N-API addon wrapping `libopenzl` (`node-addon-api` + `cmake-js`)
- [ ] Zero-copy `Buffer` in / `Buffer` out
- [ ] Run on the libuv threadpool — must not block the event loop
- [ ] Fallback chain: native addon → worker pool → CLI → gzip
- [ ] Re-run benchmarks

### Learn
N-API and node-addon-api, ABI stability across Node versions, the libuv threadpool, zero-copy buffer semantics, why "async addon" ≠ "fast addon".

### Reach
~0.1-0.5ms. Same latency class as `zlib.gzip`. This is where "competitive" stops being aspirational.

---

## Phase 3 — Trained profiles (the actual point)

**Status:** `[ ]`
**Size:** ~3-5 sessions — most interesting phase
**Depends on:** Phase 0 (can run in parallel with 1 and 2)

`src/core/engine.ts:105` hardcodes `-p serial`. Serial = opaque byte stream, generic entropy coding — it throws away the format-aware compression graph that is OpenZL's entire reason to exist.

### Tasks
- [ ] Remove hardcoded `serial`, make profile configurable
- [ ] Training pipeline: sample real payloads → derive compression graph → emit trained profile
- [ ] Ship trained profiles as assets
- [ ] Profile selection per route / per content shape
- [ ] Benchmark trained vs serial across all six corpora

### Learn
What OpenZL actually **is**. Compression graphs, tokenization, transposition, field splitting — why a numeric column compresses far better once split from surrounding JSON syntax. Serial teaches nothing; this teaches everything.

### Reach
The ratio win. Expect real gains on numeric/typed corpora, ties or losses on prose. **That asymmetry is the finding** — and it's the honest README positioning line.

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
