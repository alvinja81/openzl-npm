# openzl-express — Roadmap

> **Series 1 (Phases 0–6):** build a complete, honest OpenZL stack for Node/Express — **done** (`v0.3.0`).
>
> **Series 2 (Phases 7+):** make it **infrastructure people trust next to gzip and zstd** — not a hobby npm package.
>
> **Heroes:** gzip and zstd remain the default highway. OpenZL is the specialized lane when data shape + training pay off.
>
> **Not the goal:** claiming “always better than zstd.” **The goal:** boring install, multi-codec negotiate, sharp wins on shaped data, opt-in clients only.

**Current position:** Series 2 complete · package `0.4.0` tagged · prebuilds via GitHub Release

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

**Status:** `[x]`  
**Size:** ~2 sessions  
**Depends on:** Phase 7  
**Done:** 2026-07-28 · `v0.4.0` subpath exports + Fastify adapter

### Goal

Stop being “an Express middleware package that happens to export core.” Become **core + adapters**.

### Tasks

- [x] Subpath exports (single package, no monorepo yet):
  - [x] `openzl-express/core` — negotiate, codecs, profiles, compressBody
  - [x] `openzl-express/express` — Express middleware only
  - [x] `openzl-express/fastify` — Fastify plugin (`fastify-plugin`, breaks encapsulation)
- [x] Shared buffer compress helper (`adapters/shared.ts`) used by Fastify
- [x] Root `openzl-express` remains full re-export (back-compat)
- [x] Optional peers: `express` + `fastify` via `peerDependenciesMeta`
- [x] Tests: Express + Fastify smoke
- [ ] Future monorepo `@scope/openzl-core` publish (optional Phase 12 naming)

### Layout

```
src/core/           framework-free
src/adapters/express.ts
src/adapters/fastify.ts
src/adapters/shared.ts
src/core-entry.ts   → openzl-express/core
src/express.ts      → openzl-express/express
src/fastify.ts      → openzl-express/fastify
```

### Reach

**Hit.** Not locked to Express; Fastify proven. True multi-package monorepo can wait for broader ecosystem branding.

---

## Phase 9 — Install reliability & release hygiene

**Status:** `[x]`  
**Size:** ~2 sessions  
**Depends on:** Phase 6 workflows  
**Done:** 2026-07-28 — tooling + docs ready; **you still must tag GitHub Release for public prebuilds**

### Goal

`npm i` is boring on macOS / Linux / Windows.

### Tasks

- [x] Bump `optionalDependencies["@amirja811/openzl-cli"]` to **`^0.3.0`**
- [x] `CHANGELOG.md` (Keep a Changelog) for 0.3.0 / 0.4.0
- [x] `docs/RELEASE.md` — full tag / verify checklist
- [x] `scripts/release-check.mjs` — local preflight (`npm run release:check`)
- [x] `scripts/pack-smoke.mjs` — pack tarball + install in temp dir (`npm run pack:smoke`)
- [x] CI: pack smoke + release-check on ubuntu/mac; Windows gzip import smoke
- [x] Document install modes (ignore-scripts, OPENZL_SKIP_NATIVE, engines/zstd) in RELEASE.md + README
- [x] **Operator step:** create GitHub Release `v0.4.0` and confirm CI attaches CLI + native assets

### Commands

```bash
npm run release:check
npm run pack:smoke
# then: git tag -a v0.4.0 -m "v0.4.0" && git push origin main --tags
# GitHub Release from tag → workflows publish
```

### Reach

**Hit for tooling.** Stranger-path is ready once you **push + tag**. Until then, installs work with gzip/zstd; native prebuild download needs a published Release.

---

## Phase 10 — Browser decoder realism

**Status:** `[x]`  
**Size:** ~3–5 sessions  
**Depends on:** Phase 4 exists; only if web is a real product goal

### Goal

Either **make WASM competitive** or **demote browser** to advanced/optional so it doesn’t poison the brand.

### Decision: **demote** (2026-07-28)

1.3 MB + wasm64 is not competitive with browser-native gzip/zstd for a primary product path. Server/Node remains the story.

### Tasks

- [x] Decision gate: **ship web as primary** vs **server-only story** → **server-only primary**
- [ ] If primary: *(deferred until wasm size / wasm32 story improves)*
  - [ ] Decode-only link / DCE — target **&lt;300–500 KB** if possible
  - [ ] wasm32 feasibility research (OpenZL 64-bit assert) or wasm64 browser matrix table
  - [ ] Streaming decode if API allows
  - [ ] CDN-friendly caching headers for wasm
- [x] If demote:
  - [x] README: browser = experimental; default clients = Node + gzip/zstd
  - [x] WASM behind `openzl-express/browser` experimental entry (`browser/index.js` warns once)
  - [x] `docs/BROWSER.md` decision record

### Reach

Honest web story. WASM remains available for advanced users; it no longer defines the brand.

---

## Phase 11 — Trust: security, interop, observability

**Status:** `[x]`  
**Size:** ~2–3 sessions  
**Depends on:** Phase 7 (stable encode surface)

### Goal

Production teams can enable OpenZL without fear.

### Tasks

- [x] Decompress limits: max output size, max input size, timeouts
- [x] Fuzz or at least corpus of malformed frames (no crash)
- [x] Interop goldens: encode with native/CLI → decode with WASM/Node
- [x] Version matrix doc: OpenZL submodule rev ↔ frame compatibility
- [x] Metrics hook: `onCompress({ encoding, ratio, ms, bytesIn, bytesOut })`
- [x] Structured errors (no silent corruption)

### Delivered

- `DecompressOptions` / `LimitError` / `DecompressionError` / `OpenZLError.code`
- `onCompress` on Express, Fastify, `compressBody`
- `scripts/test-trust.mjs` + `test/fixtures/goldens/`
- `docs/COMPAT.md`

### Reach

SRE-friendly; closer to how people trust zlib/zstd.

---

## Phase 12 — Product & ecosystem

**Status:** `[x]` (foundation; naming/comparison site remain optional later)  
**Size:** ongoing  
**Depends on:** Phases 7–9 at minimum

### Goal

One sharp reason to choose this over “just gzip/zstd.”

### Tasks

- [x] Pick **flagship use case** → **metrics / time-series JSON** (binary exports as runner-up star)
- [x] One public case study or demo app with before/after vs zstd → `docs/FLAGSHIP.md` + `examples/flagship-metrics/`
- [x] Profile training DX: `npx openzl-train ./samples -o ./profiles/my.zlc` (`bin.openzl-train`)
- [ ] Optional: comparison site using `bench/` harness (later)
- [x] Community: issue templates, CODE_OF_CONDUCT, CONTRIBUTING
- [ ] Consider neutral package naming when ready for broader trust (later)

### Delivered

- Flagship docs + live demo (`npm run demo:flagship`)
- `openzl-train` CLI
- `.github/ISSUE_TEMPLATE/*`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`

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
