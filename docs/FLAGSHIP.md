# Flagship use case — metrics / time-series JSON

## Why this, not “generic compression middleware”

gzip and zstd already win for prose and mixed HTML. OpenZL earns a seat when:

1. **Payload shape is stable** (sensors, counters, fixed-width records).
2. You can **train** a compressor on real samples.
3. Clients **opt in** (`Accept-Encoding: openzl`) — usually internal services, dashboards, mobile apps, or Node fetchers.

**Chosen flagship:** **metrics / time-series JSON APIs**  
**Runner-up (even bigger ratios):** fixed-width **binary** exports (`binary`, `binary-le-u32`, SDDL).

## Measured (held-out ~100 KB corpora)

From `bench/results/phase3-profiles.md` (Apple Silicon era baselines):

| Shape | gzip6 | zstd3 | openzl trained | Profile |
|-------|------:|------:|---------------:|---------|
| API list JSON | 6.0% | 5.5% | **4.7%** | `api-list` |
| Timeseries JSON | 26.3% | 25.8% | **23.8%** | `timeseries` |
| Binary records | 62.9% | 52.5% | **13.8%** → **6.4%** SDDL | `binary` / `binary-sddl` |

**Story in one line:**

> For metrics and typed binary, train OpenZL; for the public web, keep gzip/zstd.

## Reference architecture

```
┌─────────────┐   Accept-Encoding: openzl, zstd, gzip
│  Node client │ ─────────────────────────────────────►
│  or internal │                                         │
│  dashboard   │ ◄──── Content-Encoding: openzl ─────────┤
└─────────────┘         X-OpenZL-Profile: timeseries     │
                                                         ▼
                                              ┌──────────────────┐
                                              │ openzl-express   │
                                              │ profile=timeseries│
                                              │ fallback zstd/gzip│
                                              └──────────────────┘
```

Browsers without an OpenZL decoder simply omit `openzl` and get zstd/gzip.

## How to run the demo

```bash
# from package root
npm run build
node examples/flagship-metrics/server.mjs
# → http://127.0.0.1:3456/
# → compare sizes: curl -H 'Accept-Encoding: openzl' -D- http://127.0.0.1:3456/api/metrics -o /dev/null
```

## Train on *your* metrics shape

```bash
# drop 10–20 real response bodies as files under ./samples/
npx openzl-train ./samples -o ./profiles/my-metrics.zlc --max-time 40
```

```ts
import { openzlMiddleware } from 'openzl-express/express';

app.use(openzlMiddleware({
  threshold: 512,
  profile: './profiles/my-metrics.zlc',
  // or ship name when installed with package profiles:
  // profile: 'timeseries',
  selectProfile: (req) =>
    req.path.startsWith('/api/metrics') ? 'timeseries' : 'api-list',
  onCompress: (m) => {
    // wire to your metrics backend
    console.log(m.encoding, m.bytesIn, '→', m.bytesOut, m.ms.toFixed(1) + 'ms');
  }
}));
```

## When *not* to use OpenZL

- One-off pages, HTML, blog prose (use gzip/zstd).
- Clients you don’t control (public browsers without a decoder).
- Payloads that change shape every request (training won’t stick).

## Related

- `examples/flagship-metrics/` — live compare server  
- `profiles/timeseries.zlc`, `profiles/api-list.zlc`  
- `docs/BROWSER.md` — browser is experimental  
- `docs/COMPAT.md` — frame / version matrix  
