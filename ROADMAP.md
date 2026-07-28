# openzl-express — Roadmap

> **Series 1 (Phases 0–6):** build a complete, honest OpenZL stack for Node/Express — **done** (`v0.3.0`).
>
> **Series 2 (Phases 7+):** make it **infrastructure people trust next to gzip and zstd** — not a hobby npm package.
>
> **Heroes:** gzip and zstd remain the default highway. OpenZL is the specialized lane when data shape + training pay off.
>
> **Not the goal:** claiming “always better than zstd.” **The goal:** boring install, multi-codec negotiate, sharp wins on shaped data, opt-in clients only.

**Current position:** Series 2 · **Phase 7 done** (multi-codec) · next Phase 9 (release) or 8 (core split) · package `0.3.0`

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done

---

## Where we are (audit — 2026-07-28)

### Shipped (Series 1)

| Area | State | Evidence |
|------|--------|----------|
| Benchmark harness | Done | `bench/`, `bench/results/phase0–4*` |
| Encode latency | Native ~0.1–0.4 ms; CLI ~2–4 ms | phase1/2 baselines |
| Trained profiles | api-list, timeseries, prose, binary, le-u32, **sddl** | `profiles/*.zlc` |
| Native N-API | In-tree + install script + CI workflow | `native/`, `install-native.mjs`, `build-native.yml` |
| CLI optional | `@amirja811/openzl-cli` multi-arch CI incl. Windows | `build-binaries.yml` |
| Express coverage | `write`/`end` → json/send/stream/sendFile | `src/middleware.ts`, `npm test` |
| Browser decode | WASM ~1.3 MB wasm64 + fetch + SW | `browser/` |
| Docs honesty | Wins **and** losses | `README.md`, phase3/4 reports |

### Gaps vs “worldwide / gzip·zstd class”

| Gap | Why it blocks scale | Series 2 phase |
|-----|---------------------|----------------|
| **No zstd in negotiate/middleware** | Heroes aren’t peers in the product | **7** |
| Negotiation is openzl \| gzip \| identity only | Can’t replace `compression` for modern Node | **7** |
| Express-coupled brand / no first-class core package | Fastify/Hono/edge left out | **8** |
| Prebuilds not proven “every `npm i`” | Green CI on release; assets must exist | **9** |
| WASM 1.3 MB + wasm64 | Browsers default to gzip forever | **10** |
| No security/interop suite | Decompress is attack surface | **11** |
| No single flagship use-case brand | “OpenZL middleware” is vague | **12** |
| optionalDependency still `^0.2.0` vs CLI `0.3.0` | Version skew on install | **9** |
| OpenZL still non-streaming | Documented; stream with zstd/gzip | **7** (policy) |

### Guiding principles (don’t break)

1. **`openzl` never via `*`** — browsers must not get undecodable bytes.
2. **`Vary: Accept-Encoding`** always when we compress.
3. **Install never fails** — missing native/CLI → gzip/zstd still work.
4. **Report losses** — prose/generic may lose to zstd; that’s fine.
5. **zstd stays in every bench** — honest bar.

---

## Series 1 archive (Phases 0–6) — complete

| Phase | One-liner | Status |
|-------|-----------|--------|
| 0 Baseline | Bench harness, corpora A–F, zstd honesty | `[x]` |
| 1 Kill spawn | Raw `zli` + pipes/pool ~30 ms → ~3 ms | `[x]` |
| 2 Native | N-API ~0.1–0.4 ms | `[x]` |
| 3 Profiles | Trained `.zlc`, ratio wins on shaped data | `[x]` |
| 4 WASM | Browser decode + amortization number | `[x]` |
| 5 Coverage | send/stream/sendFile + gzip Transform | `[x]` |
| 6 Ship | CI, Windows zli, install-native, README numbers | `[x]` |

Detail lives in git history and `bench/results/`. Do not re-open Series 1 unless a regression demands it.

**Series 1 end-state (achieved):**  
Native → pool → CLI → gzip; profiles; WASM decoder; Express coverage; shippable `0.3.0`.

---

# Series 2 — Worldwide next to gzip & zstd

## North star

A stranger runs:

```bash
npm install openzl-express
```

and gets:

1. **Drop-in HTTP compression** that feels as safe as `compression` (gzip + **zstd**).
2. **Optional OpenZL** when they opt in and train/select a profile — with measured wins.
3. **No broken browsers**, no failed installs, no “build Meta’s C++ first.”

**Positioning line (target):**

> Defaults like gzip/zstd. OpenZL when your payload has a shape and you train for it. Opt-in clients only.

---

## Phase 7 — Multi-codec core (gzip · zstd · openzl)

**Status:** `[x]`  
**Size:** ~2–3 sessions  
**Depends on:** nothing  
**Done:** 2026-07-28 — `src/core/zstd.ts`, negotiate + middleware  
**Priority:** P0

### Goal

Make **zstd a first-class peer** of gzip. Negotiation and middleware become a real multi-codec stack.

### Tasks

- [x] Extend `ContentEncoding` → `'openzl' | 'zstd' | 'gzip' | 'identity'`
- [x] `pickEncoding`: openzl never via `*`; zstd explicit (optional `starMeansZstd`); gzip via `*`
- [x] Runtime detect zstd via `zlib` (graceful if missing)
- [x] Middleware: zstd stream (`createZstdCompress`), gzip stream, openzl buffer
- [x] Fallback ladder after openzl failure: zstd → gzip → identity
- [x] sendFile preferStream: zstd or gzip when openzl negotiated + client allows
- [x] Tests: zstd encode/decode + negotiate unit checks in `test-middleware.mjs`
- [ ] Bench harness: re-run full matrix documenting middleware zstd path (optional follow-up)
- [ ] Docs polish in README multi-codec section (partial — expand in 0.4 release notes)

### Reach

**Hit.** Clients sending `Accept-Encoding: zstd` get zstd; `openzl, zstd, gzip` prefers openzl; browser-like `gzip, deflate, br` stays gzip. Heroes available without OpenZL.

### Notes

- `*` does **not** imply zstd by default (`starMeansZstd: false`) — safer for legacy clients.
- Node without zstd: zstd candidates omitted automatically.

---

## Phase 8 — Package architecture (core vs Express)

**Status:** `[ ]`  
**Size:** ~2 sessions  
**Depends on:** Phase 7 (share multi-codec core)

### Goal

Stop being “an Express middleware package that happens to export core.” Become **core + adapters**.

### Tasks

- [ ] Split (monorepo or clear exports):
  - [ ] `@scope/openzl-core` — negotiate, compress, profiles, native/CLI
  - [ ] `openzl-express` — thin adapter only
- [ ] Or interim: `exports` map `openzl-express/core` without full monorepo
- [ ] Fastify plugin **or** Hono middleware (one second adapter proves the split)
- [ ] Align package names for trust (optional later: move off personal scope for CLI)
- [ ] Version core and express in lockstep for v0.4

### Reach

Not locked to Express; path to “Node HTTP compression kit.”

---

## Phase 9 — Install reliability & release hygiene

**Status:** `[ ]`  
**Size:** ~2 sessions  
**Depends on:** Phase 6 workflows exist; prove them in production

### Goal

`npm i` is boring on macOS / Linux / Windows.

### Tasks

- [ ] Bump `optionalDependencies["@amirja811/openzl-cli"]` to **`^0.3.0`** (or current)
- [ ] Tag **`v0.3.0` / `v0.4.0`** release; confirm:
  - [ ] CLI binaries published for all 5 platforms
  - [ ] Native prebuild assets on GitHub Release
  - [ ] `install-native.mjs` downloads successfully on clean machine
- [ ] CI: smoke `npm pack` + install in empty dir on ubuntu/mac/windows
- [ ] Document exact “works offline / ignore-scripts” behavior
- [ ] CHANGELOG.md (Keep a Changelog)
- [ ] `engines` honesty (zstd needs newer Node — document)

### Reach

Stranger on another continent gets a working stack without cloning `facebook/openzl`.

---

## Phase 10 — Browser decoder realism

**Status:** `[ ]`  
**Size:** ~3–5 sessions  
**Depends on:** Phase 4 exists; only if web is a real product goal

### Goal

Either **make WASM competitive** or **demote browser** to advanced/optional so it doesn’t poison the brand.

### Tasks

- [ ] Decision gate: **ship web as primary** vs **server-only story**
- [ ] If primary:
  - [ ] Decode-only link / DCE — target **&lt;300–500 KB** if possible
  - [ ] wasm32 feasibility research (OpenZL 64-bit assert) or wasm64 browser matrix table
  - [ ] Streaming decode if API allows
  - [ ] CDN-friendly caching headers for wasm
- [ ] If demote:
  - [ ] README: browser = experimental; default clients = Node + gzip/zstd
  - [ ] Move WASM behind `openzl-express/browser` experimental flag only

### Reach

Honest web story. Today’s 1.3 MB + wasm64 is a **finding**, not a finished product.

---

## Phase 11 — Trust: security, interop, observability

**Status:** `[ ]`  
**Size:** ~2–3 sessions  
**Depends on:** Phase 7 (stable encode surface)

### Goal

Production teams can enable OpenZL without fear.

### Tasks

- [ ] Decompress limits: max output size, max input size, timeouts
- [ ] Fuzz or at least corpus of malformed frames (no crash)
- [ ] Interop goldens: encode with native/CLI → decode with WASM/Node
- [ ] Version matrix doc: OpenZL submodule rev ↔ frame compatibility
- [ ] Metrics hook: `onCompress({ encoding, ratio, ms, bytesIn, bytesOut })`
- [ ] Structured errors (no silent corruption)

### Reach

SRE-friendly; closer to how people trust zlib/zstd.

---

## Phase 12 — Product & ecosystem

**Status:** `[ ]`  
**Size:** ongoing  
**Depends on:** Phases 7–9 at minimum

### Goal

One sharp reason to choose this over “just gzip/zstd.”

### Tasks

- [ ] Pick **flagship use case** (recommend: **metrics / time-series JSON** or **fixed-width binary export**)
- [ ] One public case study or demo app with before/after vs zstd
- [ ] Profile training DX: `npx openzl-train ./samples -o ./profiles/my.zlc`
- [ ] Optional: comparison site using `bench/` harness
- [ ] Community: issues templates, CODE_OF_CONDUCT, CONTRIBUTING
- [ ] Consider neutral package naming when ready for broader trust

### Reach

Mindshare in a niche that can expand — not “another compression middleware.”

---

## Dependency graph (Series 2)

```
                    ┌─────────────┐
                    │ 7 Multi-    │  ← START HERE
                    │   codec     │
                    └──────┬──────┘
               ┌───────────┼───────────┐
               ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ 8 Core   │ │ 9 Install│ │ 11 Trust │
        │  split   │ │  release │ │  security│
        └────┬─────┘ └────┬─────┘ └──────────┘
             │            │
             ▼            ▼
        ┌─────────────────────┐
        │ 12 Product / brand  │
        └─────────────────────┘
             │
             ▼
        ┌──────────┐
        │ 10 WASM  │  (parallel or later; decision gate)
        └──────────┘
```

---

## Suggested execution order

| Order | Phase | When |
|-------|--------|------|
| 1 | **7 Multi-codec** | Next coding session |
| 2 | **9 Release hygiene** | Parallel / right after 7 (tag, prebuilds, dep bump) |
| 3 | **8 Core split** | After 7 stable |
| 4 | **11 Trust** | Before marketing “production” |
| 5 | **12 Product** | Always lightly; hard push after 7–9 |
| 6 | **10 WASM** | Only if browser is strategic |

**Do not** open a new full bench matrix before Phase 7. Re-run `npm run bench` **after** zstd is in the middleware path.

---

## Milestone versions (proposed)

| Version | Contains |
|---------|----------|
| **0.3.x** | Series 1 as-is (patch docs/deps only) |
| **0.4.0** | Phase 7 multi-codec (breaking if encoding types expand — ok at 0.x) |
| **0.5.0** | Phase 8 package split + one second adapter |
| **1.0.0** | Phases 7–9 + 11 solid; prebuilds green; changelog; no experimental defaults |

---

## Rules for Series 2

1. **gzip and zstd are heroes** — always available when client/platform allows.
2. **OpenZL is opt-in and shape-aware** — never the silent default for browsers.
3. **Phase 7 before vanity features** — multi-codec is the adoption unlock.
4. **Measure after each phase** — extend existing harness; don’t reinvent.
5. **Update `Current position` at the top** when a phase starts or finishes.
6. **Keep negotiate safety** — openzl never via `*`.

---

## Quick reference — commands

```bash
npm test                  # middleware smoke
npm run bench             # codec matrix
npm run train:profiles    # regenerate .zlc
npm run build:native      # local N-API
npm run build:wasm        # browser decoder
```

---

## One-line guide

| Question | Answer |
|----------|--------|
| Can users use it now? | **Yes** — Express + gzip/OpenZL opt-in at 0.3.0 |
| Is Series 1 done? | **Yes** |
| What’s left for worldwide? | **Series 2: zstd peer, install proof, core split, trust, brand** |
| Next implement? | **Phase 7 — multi-codec negotiate + middleware** |
