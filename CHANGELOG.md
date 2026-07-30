# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/) for the `0.x` line (breaking changes allowed with minor bumps until 1.0).

## [0.5.0] — 2026-07-30

### Fixed
- **Backpressure now reaches the producer.** Codec output drains into the socket through a `Writable` sink, so each chunk's flush callback (rather than a shared `drain` event that could be lost) gates the next write. `res.write` returns the codec's backpressure signal and `drain` listeners are forwarded to the codec, so `pipe()`-ing a large response to a slow client no longer buffers it in memory — measured 1 MiB in flight for a 24 MiB response while the client refused to read.
- **A codec error no longer hangs the client.** Failures now end the response: 500 when nothing has been sent yet, connection destroy once part of an encoded body is already on the wire (a silent truncation would hand the client a corrupt frame). Client aborts mid-response are treated as ordinary traffic, not logged as server errors.
- **Double `res.end()` and write-after-end are no longer able to corrupt a compressed body** — the stream path sets its ended guard, and post-end writes are dropped.
- **`threshold` now enforced on the gzip/zstd path** (Express adapter). Responses buffer until the threshold is crossed, then switch to streaming compression; smaller bodies pass through untouched. Previously a 4-byte body could be gzip'd into a larger payload. A declared `Content-Length` below the threshold short-circuits to identity immediately.
- **`Cache-Control: no-transform` honored** (RFC 9110) in both Express and Fastify adapters — such responses are never re-encoded.
- **`Vary` header appended instead of overwritten** — `Vary: Origin` set by cors or other middleware now survives (`Vary: Origin, Accept-Encoding`). Fastify plugin also sets `Vary` on all negotiable responses, not only compressed ones.

### Added
- Regression tests for the threshold, `no-transform`, and `Vary` fixes in the Express and Fastify smoke suites.
- **`scripts/test-stream.mjs`** (`npm run test:stream`, wired into `npm test` and CI): backpressure under a paused client, large-body integrity for gzip and zstd, client abort survival, double-end and write-after-end safety. Fails on stall instead of hanging.

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

[0.4.2]: https://github.com/alvinja81/openzl-npm/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/alvinja81/openzl-npm/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/alvinja81/openzl-npm/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/alvinja81/openzl-npm/releases/tag/v0.3.0
