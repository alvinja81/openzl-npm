# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/) for the `0.x` line (breaking changes allowed with minor bumps until 1.0).

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

[0.4.0]: https://github.com/alvinja81/openzl-npm/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/alvinja81/openzl-npm/releases/tag/v0.3.0
