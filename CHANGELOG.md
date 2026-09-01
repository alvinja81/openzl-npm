# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/). The `0.x` line allowed breaking minor bumps; **1.0.0** is the first stable contract.

## [Unreleased]

## [1.0.0] — 2026-08-30

1.0 is a **contract cut**: gzip / brotli / zstd are the default highway; OpenZL stays opt-in. No experimental defaults.

### Added
- **`docs/MIGRATION.md`** — replacing `compression` and `@fastify/compress` (option map, negotiation differences, do not stack).
- **`SECURITY.md`** — private advisory path and supported versions.
- **`docs/CASE-STUDY.md`** — measured corpora, reproduce commands, production checklist.
- **Node `createOpenZLFetch` / `decodeOpenZLResponse`** (`openzl-express/core`) — send `Accept-Encoding: openzl, zstd, br, gzip` and inflate OpenZL bodies. gzip/br/zstd stay with the runtime.
- **`npx openzl-train` held-out compare** — after training, prints gzip / br / zstd / openzl sizes and a verdict (`enable` | `keep-heroes`). `--strict` exits 2 on a loss. `--no-compare` skips.
- **Fastify streaming** for gzip / br / zstd when `reply.send` is a Node `Readable`. JSON/string bodies still buffer. 204/205/304/206 are not re-encoded. OpenZL + stream prefers a hero codec when the client also accepts one (`preferStreamGzip`, default true).
- **HTTP middleware bench** — `npm run bench:http` → `bench/results/middleware.md`.
- Flagship demo: imports the published package when installed, includes **br** in `/api/compare`, ships `profiles/samples` in the tarball.

### Changed
- README leads with gzip/br/zstd. 30-second Express start no longer sets an OpenZL `profile`.
- Supported-platform table is a 1.0 guarantee: OpenZL native prebuilds on linux-x64, linux-arm64, darwin-arm64 only.
- `docs/RELEASE.md` examples updated off 0.4.0.

### 1.0 guarantees (unchanged behavior, now promised)
- `openzl` never via `Accept-Encoding: *`
- `debugHeaders` default false
- Browser WASM experimental
- Install never fails if native/CLI is missing

## [0.5.1] — 2026-08-21

### Fixed
- **A range request could be answered with the whole file.** When OpenZL was the only encoding a client accepted, the `sendFile` override read the entire file and compressed it, ignoring `Range` entirely: `Range: bytes=0-99` returned **HTTP 200 with the complete file, openzl-encoded**, instead of a 206 slice. Range requests now stay on Express's own path. Covered by a regression test that was confirmed to fail against the previous code.
- **`206 Partial Content` responses are no longer re-encoded.** A 206 body is a byte range of the *identity* representation and its `Content-Range` counts those bytes, so compressing it makes the range describe something the client never asked for. `204`, `205` and `304` are skipped for the same class of reason (no body to encode).

### Changed
- **The `darwin-x64` prebuild leg is dropped.** Confirmed on the first push after the workflow fixes: `linux-x64`, `linux-arm64` and `darwin-arm64` all build in ~90 s, but the `macos-15-intel` runner is never allocated within the job window on this account. Marking it optional was not enough — a *queued* job keeps the whole run pending, so the run's result stayed unusable for hours. Intel Mac users build from source or use the `zli` CLI.
- **`X-OpenZL-*` diagnostic headers are now opt-in** via `debugHeaders` (default `false`), in both adapters. They were sent on every compressed response, costing bytes and disclosing the uncompressed body size (`X-Original-Size`). Set `debugHeaders: true` while tuning profiles to get them back.
- **`HEAD` now advertises the `Content-Encoding` that `GET` would return**, instead of silently omitting it. Only claimed when knowable — the app must have declared a `Content-Length` at or above `threshold`, since otherwise `GET` might have fallen through to identity — and that declared length (which describes the uncompressed body) is dropped so it cannot contradict the advertised encoding.
- Housekeeping: embedded `openzl/` gitlink untracked; child repo ignored.

### Notes
- First **tagged** 0.5.x release. `0.5.0` features (brotli, dual ESM/CJS, prebuild CI) lived on `main` / in CHANGELOG but were not previously tagged or published to npm (`latest` was still `0.4.2`).

## [0.5.0] — 2026-07-30

### Added
- **Brotli (`br`) support** — the encoding every browser actually sends, via Node's built-in `zlib` (no new dependencies). Streaming and buffered paths, Express and Fastify, plus `compressBrotli` / `decompressBrotli` / `createBrotliStream` / `isBrotliAvailable` from the core entry.
  - Default quality **4**, not zlib's default of 11: on a 188 KB JSON response, quality 4 produced **32.5 KB in 1.14 ms** versus gzip's 37.6 KB in 1.86 ms — smaller *and* faster. Quality 11 reached 23.6 KB but took **181.8 ms** (~160× slower), which is a build-time setting, not a per-request one. Tune with `brotliQuality`.
  - New options: `allowBrotli`, `brotliQuality` (Express and Fastify); `preferBrotli`, `allowBrotli`, `starMeansBrotli` on `pickEncoding`.

### Added — CommonJS support
- **The package now ships both ESM and CommonJS builds.** It was ESM-only, so `require('openzl-express')` failed outright — excluding a large share of existing Express apps. Every entry point (`.`, `/core`, `/express`, `/fastify`) is available to both syntaxes, with separate type declarations per condition so `moduleResolution: node16` resolves correctly either way.
- Built with **tsup, deliberately with `bundle: false`**. Bundling would inline a private copy of `core` into each entry point, so importing both `openzl-express` and `openzl-express/core` would create **two OpenZL CLI process pools and two native-addon caches**. Unbundled output keeps one shared instance, which `pack-smoke` now asserts.
- `dist/cjs/` carries `{"type":"commonjs"}`; the CJS half uses `.js` files, because with unbundled output the emitted internal specifiers (`require('./core/index.js')`) must keep resolving.
- **`scripts/test-dual.mjs`** (`npm run test:dual`, in `npm test` and CI): checks both conditions exist with `types` listed first, that every target file is present, that the CJS output contains no `import.meta` or ESM syntax, that entries share `core` instead of inlining it, and — against the real packed tarball — type-checks an ESM *and* a CJS consumer under `moduleResolution: node16`, plus a runtime `require()`.
- `release-check` now verifies every export condition resolves to a file that exists and that `dist/cjs` is marked CommonJS. It previously only checked that the export keys were present, so a broken dual build would have published cleanly.
- `npm run build` keeps an explicit `tsc --noEmit` typecheck, which the old `tsc`-as-build provided implicitly.
- Source maps and declaration maps are no longer published. `tsc` emitted them pointing at `../src/*.ts`, but `src` is not in `files`, so every published map referenced a file absent from the tarball.

### Fixed — native prebuild delivery (no platform was getting one)
- **Prebuilds now actually reach releases.** `attach-release` in `build-native.yml` used a plain `needs:` on the build matrix, so a single failing platform skipped it entirely. Windows fails on every run (see below) and an Intel-macOS runner stalled for 5+ hours, so the job was skipped on **every release to date** — v0.4.x releases carry **zero** prebuild assets, and `postinstall` 404s for every platform. It now runs with `if: always()`, packs whatever platforms succeeded, and fails only when nothing built at all. linux-x64, linux-arm64, and darwin-arm64 each build in ~90 s and were being discarded.
- **Each platform now attaches its own release asset** instead of a gather job doing it. A gather job must `needs:` the whole matrix, and macOS runners on this account queue for many hours — Linux prebuilds that were ready in 90 seconds would have waited for them. `attach-release` is now only a verification step that fails if nothing landed.
- **`ci.yml` had never passed either.** Its Linux legs finish in ~20 s and pass, but every macOS leg queued ~16 hours and was then killed by GitHub's hard 6-hour job ceiling, so the workflow ended `cancelled` or `failure` on every run. macOS is reduced to a single best-effort leg (`continue-on-error`), Linux covers Node 18/20/22/24, and superseded runs are cancelled via a `concurrency` group. Since macOS bills at 10×, three legs × 6 h per run was also consuming the minutes that caused the starvation.
- **`@openzl-cli` packing/publishing moved off `macos-latest`** to `ubuntu-latest`; it needs no macOS and was sitting in the same queue.
- **Job timeouts added** to every workflow (40 min for native builds). Runs previously went 5–19 hours before failing.
- **Windows and Intel-macOS legs are marked optional** (`continue-on-error`). OpenZL's C sources do not compile under MSVC (`C2099: initializer is not a constant` in `encoder_registry.c`), so that leg is expected to fail until upstream changes; it no longer blocks everyone else. gzip/brotli/zstd are unaffected on Windows.
- **`@openzl-cli` binary publishing had the identical defect** in `build-binaries.yml` and got the same fix.

### Changed
- **The npm tarball no longer bundles prebuilds** (`files` drops `prebuilds`). It shipped whatever happened to sit in the publisher's working directory, so the artifact depended on the publish machine: a local `npm pack` on macOS embedded a 3.8 MB darwin-arm64 addon, while the CI publish ran from a clean checkout and embedded nothing. The published `0.4.2` tarball therefore contains **zero** prebuilds — which, combined with the release assets never being attached, means **no user on any platform has ever received the OpenZL native addon from npm**. Every platform now obtains it the same way, via `postinstall` from the release. Package size (from a developer machine) drops **1.6 MB → 357 kB**.
- `postinstall` **verifies an addon before trusting it**: it loads the binary and runs a compress/decompress roundtrip. A corrupt or truncated file is discarded and re-fetched instead of being kept forever — previously any existing file short-circuited the installer, so a bad download could never repair itself.
- `postinstall` **detects musl libc** (Alpine) and skips the download rather than installing a glibc binary that cannot load there.
- Publishing waits (up to 10 min, non-fatal) for prebuild assets to be attached, so installs immediately after a release find one.
- **Negotiation order is now openzl → zstd → br → gzip** for equal q-values. A client sending a normal browser header (`gzip, deflate, br`) now receives **brotli instead of gzip**; `gzip, deflate, br, zstd` still receives zstd. Explicit q-values continue to win over this order (`br;q=0.5, gzip` → gzip), and `Accept-Encoding: *` still means gzip only. Set `allowBrotli: false` to keep the previous behavior.
- **`fallbackToGzip` now gates every OpenZL fallback uniformly.** Previously a zstd fallback happened even with `fallbackToGzip: false`, which contradicted the option. With it disabled, a failed OpenZL encode now sends the body uncompressed.

### Fixed
- **Backpressure now reaches the producer.** Codec output drains into the socket through a `Writable` sink, so each chunk's flush callback (rather than a shared `drain` event that could be lost) gates the next write. `res.write` returns the codec's backpressure signal and `drain` listeners are forwarded to the codec, so `pipe()`-ing a large response to a slow client no longer buffers it in memory — measured 1 MiB in flight for a 24 MiB response while the client refused to read.
- **A codec error no longer hangs the client.** Failures now end the response: 500 when nothing has been sent yet, connection destroy once part of an encoded body is already on the wire (a silent truncation would hand the client a corrupt frame). Client aborts mid-response are treated as ordinary traffic, not logged as server errors.
- **Double `res.end()` and write-after-end are no longer able to corrupt a compressed body** — the stream path sets its ended guard, and post-end writes are dropped.
- **`threshold` now enforced on the gzip/zstd path** (Express adapter). Responses buffer until the threshold is crossed, then switch to streaming compression; smaller bodies pass through untouched. Previously a 4-byte body could be gzip'd into a larger payload. A declared `Content-Length` below the threshold short-circuits to identity immediately.
- **`Cache-Control: no-transform` honored** (RFC 9110) in both Express and Fastify adapters — such responses are never re-encoded.
- **`Vary` header appended instead of overwritten** — `Vary: Origin` set by cors or other middleware now survives (`Vary: Origin, Accept-Encoding`). Fastify plugin also sets `Vary` on all negotiable responses, not only compressed ones.

### Added — tests
- Regression tests for the threshold, `no-transform`, and `Vary` fixes in the Express and Fastify smoke suites, plus brotli coverage (negotiation, streaming, `sendFile`, threshold, `*`-is-not-`br`, 24 MiB integrity).
- **`scripts/test-stream.mjs`** (`npm run test:stream`): backpressure under a paused client, large-body integrity for gzip, brotli, and zstd, client abort survival, double-end and write-after-end safety. Fails on stall instead of hanging.
- **`scripts/test-prebuild.mjs`**: prebuild target selection (including musl), addon verification (rejects corrupt/missing binaries), release-asset naming agreement with the workflow, and assertions that the workflow still attaches prebuilds when a platform fails.
- `pack-smoke.mjs` now exercises brotli and the `br` negotiation path against the packed tarball. It caught a real break in this release: `install-native.mjs` imported a helper missing from `files`, which would have crashed `postinstall` on every install.

## [0.4.3] — 2026-07-30

### Added
- **LICENSE file** (MIT). The package previously declared MIT in `package.json` but shipped no license text.

### Changed
- **README honesty pass:**
  - Documented that the bundled native prebuild is **macOS arm64 only**; Linux/Windows need `@amirja811/openzl-cli` or a source build (gzip/zstd unaffected).
  - Documented known 0.4.x limitation: `threshold` is only enforced on the buffered (openzl) path — gzip/zstd streaming responses compress regardless of size. Fix planned for 0.5.

## [0.4.2] — 2026-07-29

### Changed
- **README** rewritten for npm consumers: install, 30s start, copy-paste test curls, negotiation table, options, train path. Internal roadmap moved out of the primary doc.

## [0.4.1] — 2026-07-29

### Fixed
- CI / npm publish: smoke tests **soft-skip openzl** when native/CLI are missing; **gzip/zstd heroes still required**.
- Publish workflow continues when optional `@amirja811/openzl-cli` is absent.

### Notes
- First successful Series 2 publish (0.4.0 tag existed but CI failed before npm).

## [0.4.0] — 2026-07-28

### Added
- **Multi-codec negotiation:** `openzl` (explicit opt-in) · **zstd** · **gzip** · identity (`src/core/negotiate.ts`, `src/core/zstd.ts`).
- **Streaming zstd** in Express middleware when Node zlib provides `createZstdCompress`.
- **Package subpath exports:**
  - `openzl-express/core` — framework-free
  - `openzl-express/express` — Express middleware
  - `openzl-express/fastify` — Fastify plugin (`fastify-plugin`)
- Shared `compressBody` helper for adapters.
- Fastify smoke tests (`scripts/test-fastify.mjs`).
- Series 2 roadmap (Phases 7–12).
- **Phase 11 trust:**
  - Decompress limits: `maxInputBytes`, `maxOutputBytes`, `timeoutMs` (`DecompressOptions`)
  - Structured errors: `OpenZLError`, `LimitError`, `DecompressionError` + `code`
  - Metrics: `onCompress({ encoding, ratio, ms, bytesIn, bytesOut })` (Express / Fastify / `compressBody`)
  - Interop + malformed tests: `scripts/test-trust.mjs`, goldens under `test/fixtures/goldens/`
  - Compatibility matrix: `docs/COMPAT.md`
- **Phase 10 browser:** demoted to **experimental** (`docs/BROWSER.md`, `openzl-express/browser` entry warns once).
- **Phase 12 product:**
  - Flagship: metrics / time-series JSON (`docs/FLAGSHIP.md`, `examples/flagship-metrics/`, `npm run demo:flagship`)
  - Train CLI: `npx openzl-train ./samples -o ./my.zlc` (`bin.openzl-train`)
  - Community: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, GitHub issue templates

### Changed
- Express middleware moved under `src/adapters/express.ts` (root re-export kept).
- Optional peer: `express` and `fastify` are both optional peers.
- `@amirja811/openzl-cli` optionalDependency range → `^0.3.0`.

### Notes
- `Accept-Encoding: *` maps to **gzip** only (not openzl, not zstd by default).
- zstd requires a Node build that ships zlib zstd (typically **Node ≥ 22.15** / recent 23+). On older Node, zstd is skipped automatically; gzip remains.

## [0.3.0] — 2026-07-28

### Added
- Browser WASM decoder (`browser/`, `npm run build:wasm`), fetch wrapper, service worker, amortization UI.
- Middleware coverage: `write`/`end` hooks for `json` / `send` / streams / `sendFile`; streaming gzip.
- Native install hook (`scripts/install-native.mjs`) and CI for platform prebuilds.
- CLI CI matrix includes **Windows** (`win32-x64`).
- Trained profiles + SDDL binary profile; native path for trained compressors (where supported).
- README rewritten with measured latency/ratio/WASM numbers.

### Changed
- Package files/scripts for WASM, native, train, and browser assets.

## [0.2.0] — prior

### Added
- Express middleware with OpenZL + gzip fallback.
- Framework-free core compress/decompress via `zli` CLI.
- Content negotiation (`openzl` explicit-only).

---

[1.0.0]: https://github.com/alvinja81/openzl-npm/compare/v0.5.1...v1.0.0
[0.5.1]: https://github.com/alvinja81/openzl-npm/compare/v0.4.2...v0.5.1
[0.5.0]: https://github.com/alvinja81/openzl-npm/blob/main/CHANGELOG.md#050--2026-07-30
[0.4.3]: https://github.com/alvinja81/openzl-npm/blob/main/CHANGELOG.md#043--2026-07-30
[0.4.2]: https://github.com/alvinja81/openzl-npm/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/alvinja81/openzl-npm/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/alvinja81/openzl-npm/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/alvinja81/openzl-npm/releases/tag/v0.3.0
