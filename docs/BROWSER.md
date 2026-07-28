# Browser decoder — Phase 10 decision

## Decision: **demote** (experimental, not primary)

| Option | Verdict |
|--------|---------|
| Ship web as primary client path | **No** — wasm64 + ~1.3 MB decoder is not competitive with browser-native gzip/zstd |
| Server-only product story + optional browser | **Yes** — default clients are Node + gzip/zstd |

### Why demote

1. **Size:** `openzl_decode.wasm` is ~1.3 MB. Transfer break-even vs gzip often needs **hundreds–thousands** of similar OpenZL responses per session (`bench/results/phase4-wasm.md`).
2. **wasm64 / MEMORY64:** OpenZL asserts 64-bit `size_t`. Many browsers/environments still lack solid wasm64. Clients without it must stay on gzip/zstd.
3. **Heroes:** For the public web, **gzip and zstd** remain the highway. OpenZL stays an **opt-in specialized lane** (Node services, internal tools, trained mobile/desktop clients).

### What still ships

| Path | Status |
|------|--------|
| `openzl-express` Node core / Express / Fastify | **Supported** |
| `openzl-express/browser/*` | **Experimental** — no stability promise |
| WASM build scripts | Advanced / contributor path |

### Experimental contract

- API may change without a major bump while marked experimental.
- Prefer `Accept-Encoding: gzip` (and `zstd` where available) for any public browser UI.
- Only send `openzl` when you control both ends **and** have measured amortization.
- Always keep gzip as a fallback in `Accept-Encoding`.

### When we would revisit “web as primary”

- Decode-only link under **~300–500 KB**, **or**
- OpenZL builds cleanly for **wasm32** with acceptable ratio/latency, **or**
- Streaming decode + CDN-friendly packaging with a clear multi-request win in a flagship app.

Until then, browser work does not block releases or marketing.

See also: `browser/README.md`, `docs/COMPAT.md`, Phase 12 flagship (Node metrics APIs).
