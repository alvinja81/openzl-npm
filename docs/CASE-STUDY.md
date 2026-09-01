# Case study — metrics JSON (held-out corpora)

**Verdict on this repo’s metrics API: enable OpenZL.**

Held-out body `profiles/samples/timeseries/sample-9.json` (26 207 bytes), shipped `timeseries` profile, Node on the maintainer machine (2026-09-01):

| Codec | Bytes | Ratio | Encode |
|-------|------:|------:|-------:|
| gzip | 6964 | 26.57% | 1.57 ms |
| br | 6522 | 24.89% | 3.38 ms |
| zstd | 6584 | 25.12% | 1.18 ms |
| **openzl (`timeseries`)** | **6273** | **23.94%** | 8.07 ms |

`compareHeldOut` said **enable** — OpenZL is smaller than the best hero (br). A locally retrained `.zlc` matched (6278 bytes). Browsers still get br; only clients that send `Accept-Encoding: openzl` take this lane.

This is the Level 4 proof we can publish from this repo: **measured numbers on a stable shape**, not a third-party production account. Treat it as the template for a real workload — swap in your samples and re-run `npx openzl-train --strict`.

## Workload

| Field | Value |
|-------|--------|
| Shape | Repetitive metrics / time-series JSON (sensor-like records) |
| Size | ~100 KB held-out bodies (`profiles/samples/timeseries/`) |
| Server | `openzl-express` Express middleware, profile `timeseries` |
| Clients | Must send `Accept-Encoding: openzl` (Node fetch helper or internal service). Browsers stay on br/zstd/gzip. |
| Hardware | Apple Silicon / Node 24 era (see `bench/results/phase3-profiles.md`) |

## Results (codec-in-process, trained OpenZL)

From `bench/results/phase3-profiles.md` — lower % is smaller:

| Shape | gzip L6 | zstd L3 | OpenZL trained | Call |
|-------|--------:|--------:|---------------:|------|
| API list JSON | 6.0% | 5.5% | **4.7%** | Enable OpenZL |
| Timeseries JSON | 26.3% | 25.8% | **23.8%** | Enable OpenZL (modest) |
| Prose JSON | 2.9% | **2.0%** | 2.1% | **Leave OpenZL off** |
| Binary records | 62.9% | 52.5% | **13.8%** → **6.4%** SDDL | Enable OpenZL |

Encode with the native addon on ~100 KB is typically **0.1–0.4 ms**, the same class as zstd L3.

Live flagship demo in this tree (`npm run demo:flagship`, trained `.zlc` on `sample-19.json`, ~26 KB):

| Codec | Bytes | Ratio |
|-------|------:|------:|
| gzip | 7521 | 28.6% |
| br | 6624 | 25.19% |
| zstd | 6681 | 25.41% |
| **openzl trained** | **6371** | **24.23%** |

OpenZL wins on this shape (and would get an `enable` verdict). Browsers still get br.

Untrained `serial` on a 188 KB generic JSON **lost** to brotli quality 4 and zstd (README hero table). Training is not optional for the OpenZL lane.

## Reproduce

```bash
# 1. Compare shipped timeseries vs heroes on a held-out sample
node -e "
import fs from 'fs';
import { compareHeldOut, formatCompareTable } from './scripts/lib/compare-profile.mjs';
const files = fs.readdirSync('profiles/samples/timeseries').filter(f => f.endsWith('.json')).sort();
const plain = fs.readFileSync('profiles/samples/timeseries/' + files.at(-1));
const r = await compareHeldOut(plain, { profile: 'timeseries' });
console.log(formatCompareTable(r, { heldOut: files.at(-1) }));
"

# 2. HTTP path (Express middleware), localhost
npm run bench:http

# 3. Live demo
npm run demo:flagship
# curl -sH 'Accept-Encoding: openzl' -D- http://127.0.0.1:3456/api/metrics -o /dev/null
```

## Production checklist (copy this)

1. Save 10–20 **real** response bodies, plus one held-out file you did not train on.
2. `npx openzl-train ./samples -o ./profiles/my.zlc --held-out ./samples/held-out.json`
3. Enable OpenZL **only** if the verdict is `enable`. Otherwise keep br/zstd.
4. Clients: `createOpenZLFetch()` or send `Accept-Encoding: openzl, zstd, br, gzip`.
5. Wire `onCompress` to your metrics. Leave `debugHeaders` off in production.
6. Re-train when the payload shape changes.

## What this is not

Not a public-web win. Not “always smaller than zstd.” Not a substitute for gzip/br on HTML. If your live traffic looks like **prose**, the table says keep zstd.

When you have a named production API, replace this file’s “Workload” table with that API and paste a fresh `openzl-train` table above the synthetic one.
