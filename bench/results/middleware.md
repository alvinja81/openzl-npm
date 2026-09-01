# Middleware HTTP bench

Node v26.5.0 · darwin/arm64
Payload 52191 bytes (JSON list, Express `openzlMiddleware`).
Times are end-to-end localhost (encode + transfer + decode), p50 of 7 after 1 warmup.

| Codec | Bytes | Ratio | p50 | Roundtrip |
|-------|------:|------:|----:|:----------|
| gzip | 6352 | 12.17% | 0.77 ms | ok |
| br | 2106 | 4.04% | 0.53 ms | ok |
| zstd | 2543 | 4.87% | 0.35 ms | ok |
| openzl | 2778 | 5.32% | 0.47 ms | ok |
