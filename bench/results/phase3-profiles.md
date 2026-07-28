# Phase 3 — Trained vs serial ratio report

> Generated 2026-07-27T12:25:38.489Z. Profiles under `profiles/`.

| Corpus | Orig | gzip6 | zstd3 | openzl serial | trained | trained name | serial → trained |
|--------|-----:|------:|------:|--------------:|--------:|--------------|-----------------:|
| A api-list | 102446 | 6165 (6.0%) | 5633 (5.5%) | 9176 (9.0%) | **4808 (4.7%)** | api-list | **−47.6%** |
| B timeseries | 102524 | 26957 (26.3%) | 26486 (25.8%) | 26240 (25.6%) | **24425 (23.8%)** | timeseries | **−6.9%** |
| C prose | 103034 | 2986 (2.9%) | 2040 (2.0%) | 3559 (3.5%) | **2152 (2.1%)** | prose | **−39.5%** |
| D compact | 102417 | 33575 (32.8%) | 33066 (32.3%) | 34131 (33.3%) | — | — | — |
| F binary-records | 102400 | 64456 (62.9%) | 53797 (52.5%) | 66234 (64.7%) | **14170 (13.8%)** | binary | **−78.6%** |
| F binary-records | 102400 | 64456 (62.9%) | 53797 (52.5%) | 66234 (64.7%) | **7662 (7.5%)** | binary-le-u32 | **−88.4%** |

## Finding

- **Binary (F):** training turns a loss vs zstd into a blowout win (13.8% vs zstd 52.5%). Starting the trainer from a *typed* base (`le-u32` instead of `serial`) nearly halves it again: **7.5% — 6.9× smaller than zstd L19 (51.3%)**, with faster decode (0.106ms vs 0.159ms p50). Lesson: every bit of shape declared up front multiplies what training finds (serial-trained < typed-trained < full description).
- **API list (A):** trained profile beats gzip **and** zstd (4.7% vs 5.5%/6.0%).
- **Prose (C):** trained nearly matches zstd L3; untrained serial was worse.
- **Timeseries (B):** solid ~7% trained edge over serial; competitive with zstd.
- **Compact (D):** no dedicated profile yet — serial ≈ zstd.

**Positioning line (earned):**

> Better ratio for shape-matched / typed payloads when you train. Competitive latency with native encode. Opt-in clients (`Accept-Encoding: openzl`).

Not a gzip replacement. Doesn't need to be.

## How to use

```ts
import { compress, openzlMiddleware } from 'openzl-express';

await compress(buf, { profile: 'timeseries' });

app.use(openzlMiddleware({
  profile: 'serial',
  selectProfile: (req) =>
    req.path.startsWith('/metrics') ? 'timeseries' : 'api-list'
}));
```

Regenerate assets after sample shape changes:

```bash
npm run train:profiles
```
