# Flagship demo — metrics / time-series JSON

Live before/after for the Phase 12 product story, wired to **real training samples** under `profiles/samples/timeseries/`.

## Run

```bash
# from this repo
npm run demo:flagship

# after `npm install openzl-express` (tarball includes examples + samples)
node node_modules/openzl-express/examples/flagship-metrics/server.mjs

# optional: retrain
npx openzl-train profiles/samples/timeseries \
  -o examples/flagship-metrics/trained-metrics.zlc \
  -p serial --max-time 30
```

Open **http://127.0.0.1:3456/**

| URL | What |
|-----|------|
| `/api/compare` | Side-by-side openzl / gzip / zstd sizes + encode ms |
| `/api/metrics` | Held-out sample with **content negotiation** |
| `/api/metrics/0` | Corpus sample-0.json (etc.) |
| `/api/health` | Profile path, backend, sample count |

```bash
curl -sH 'Accept-Encoding: openzl' -D- http://127.0.0.1:3456/api/metrics -o /dev/null
curl -s http://127.0.0.1:3456/api/compare | jq .
```

If `trained-metrics.zlc` exists, the server uses it; otherwise shipped `timeseries`.

## Why this demo

Repetitive sensor JSON is the niche where OpenZL is easier to justify than “replace gzip for everything.”

Details: [`docs/FLAGSHIP.md`](../../docs/FLAGSHIP.md).

`trained-metrics.zlc` is gitignored (regenerate with openzl-train); the demo works without it.
