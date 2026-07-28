# Contributing to openzl-express

Thanks for helping make multi-codec OpenZL + gzip + zstd boring to operate.

## Product principles (don’t break these)

1. **`openzl` never via `Accept-Encoding: *`** — browsers must not get undecodable bytes by accident.
2. **`Vary: Accept-Encoding`** whenever we compress.
3. **Install never fails** — missing native/CLI → gzip/zstd still work.
4. **Heroes first** — gzip and zstd remain the default highway; OpenZL is the specialized lane.
5. **Browser is experimental** — see `docs/BROWSER.md`. Don’t market WASM as production-default.

## Setup

```bash
npm install
npm run build
npm test
```

Optional (encode backends):

```bash
npm run build:native   # N-API addon
# zli via optionalDependency @amirja811/openzl-cli
```

## Development map

| Path | Role |
|------|------|
| `src/core/` | Framework-free compress / negotiate / limits |
| `src/adapters/` | Express + Fastify |
| `profiles/` | Shipped + trained `.zlc` assets |
| `scripts/test-*.mjs` | Smoke tests (no heavy framework) |
| `bench/` | Ratio / latency harness |
| `examples/flagship-metrics/` | Product demo |
| `docs/` | RELEASE, COMPAT, BROWSER, FLAGSHIP |

## Pull requests

- Prefer small, focused PRs.
- Update `CHANGELOG.md` under `[Unreleased]` or the next version section.
- Add/adjust smoke tests when changing negotiate, middleware, or decompress limits.
- Run `npm test` and `npm run release:check` before asking for review.

## Training profiles

Regenerate shipped profiles:

```bash
npm run train:profiles
```

Train a custom compressor for your data:

```bash
npx openzl-train ./path/to/samples -o ./my.zlc -p serial
```

## Reporting bugs

Use [GitHub Issues](https://github.com/alvinja81/openzl-npm/issues) with:

- Node version + OS
- Whether native / zli / zstd are available (`getActiveBackend()`, `isZstdAvailable()`)
- Minimal Accept-Encoding / payload shape if HTTP-related

Security-sensitive decompress crashes: prefer a private report; include only minimal malformed frames.

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
