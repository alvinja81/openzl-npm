# Flagship demo — metrics / time-series JSON

Live before/after for the Phase 12 product story.

## Run

```bash
# from monorepo root
npm run build
npm run demo:flagship
# or: node examples/flagship-metrics/server.mjs
```

Open **http://127.0.0.1:3456/** for a size table, or hit:

| URL | What |
|-----|------|
| `/api/compare` | Side-by-side openzl / gzip / zstd sizes + encode ms |
| `/api/metrics` | Same payload with **content negotiation** |

```bash
curl -sH 'Accept-Encoding: openzl' -D- http://127.0.0.1:3456/api/metrics -o /dev/null
```

Look for `content-encoding: openzl` and `x-openzl-profile: timeseries`.

## Why this demo

Trained **timeseries** profile on repetitive sensor JSON — the niche where OpenZL is easier to justify than “replace gzip for everything.”

Details: [`docs/FLAGSHIP.md`](../../docs/FLAGSHIP.md).
