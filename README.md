# openzl-express

Express middleware that compresses JSON responses with [OpenZL](https://github.com/facebook/openzl) (Meta's format-aware compression framework) for clients that opt in — and standard **gzip for everyone else**.

## How it works

The middleware negotiates compression from the client's `Accept-Encoding` header:

| Client sends | Response |
|---|---|
| `Accept-Encoding: openzl` | OpenZL-compressed (`Content-Encoding: openzl`) |
| `Accept-Encoding: gzip` (browsers, curl, axios — the default) | gzip-compressed |
| Neither | Uncompressed JSON |

Browsers and normal HTTP clients never receive OpenZL data by accident — they get gzip, which they decode transparently. Only clients that explicitly send `Accept-Encoding: openzl` (and know how to decode it) get OpenZL.

If the OpenZL CLI is missing or fails, the middleware automatically falls back to gzip.

## Installation

```bash
npm install openzl-express
```

This pulls in [`@amirja811/openzl-cli`](https://www.npmjs.com/package/@amirja811/openzl-cli) as an optional dependency, which provides the `zli` binary.

> **Platform support:** prebuilt `zli` binaries are currently available for **macOS (Apple Silicon)** and **Linux (x64/arm64)** where CI has built them. On other platforms the middleware still works — it serves gzip. You can also [build `zli` from source](https://github.com/facebook/openzl).

## Usage

### Basic setup

```typescript
import express from 'express';
import { openzlMiddleware } from 'openzl-express';

const app = express();
app.use(openzlMiddleware());

app.get('/api/data', (req, res) => {
  res.json({ data: [/* large dataset */] });
});

app.listen(3000);
```

### With configuration

```typescript
app.use(openzlMiddleware({
  enabled: true,        // Enable/disable compression (default: true)
  threshold: 1024,      // Min size in bytes to compress (default: 1024)
  fallbackToGzip: true, // Fallback to gzip if OpenZL fails (default: true)
  debug: false,         // Enable debug logging (default: false)
  onError: (err, req, res) => {
    console.error('Compression error:', err);
  }
}));
```

### Consuming OpenZL responses from a Node.js client

```typescript
import { decompressWithOpenZL } from 'openzl-express';

const res = await fetch('http://localhost:3000/api/data', {
  headers: { 'Accept-Encoding': 'openzl' }
});

let body = Buffer.from(await res.arrayBuffer());
if (res.headers.get('content-encoding') === 'openzl') {
  body = await decompressWithOpenZL(body);
}
const data = JSON.parse(body.toString('utf-8'));
```

### Checking CLI availability

```typescript
import { checkCLIAvailable } from 'openzl-express';

if (!(await checkCLIAvailable())) {
  console.warn('OpenZL CLI not found — responses will use gzip');
}
```

## Response headers

OpenZL-compressed responses:

```
Content-Encoding: openzl
Content-Type: application/json; charset=utf-8
Vary: Accept-Encoding
X-OpenZL-Ratio: 23.45%
X-Original-Size: 125000
X-Compressed-Size: 29312
```

Gzip fallback after an OpenZL failure additionally carries:

```
X-Compression-Fallback: gzip
X-OpenZL-Error: OpenZLCLINotFoundError
```

## API reference

### `openzlMiddleware(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable or disable compression |
| `threshold` | `number` | `1024` | Minimum response size in bytes to trigger compression |
| `fallbackToGzip` | `boolean` | `true` | Fallback to gzip if OpenZL fails |
| `onError` | `function` | `undefined` | Error handler: `(err, req, res) => void` |
| `debug` | `boolean` | `false` | Enable debug logging |

### Other exports

- `compressWithOpenZL(buffer)` / `decompressWithOpenZL(buffer)` — direct CLI access
- `checkCLIAvailable()` — returns `Promise<boolean>`
- `resetCLICache()` — clear the cached CLI location
- `OpenZLCLINotFoundError`, `CompressionError` — error classes

## Performance notes

- Compression shells out to the `zli` CLI via temp files (~10–50 ms per request for process spawn). For small/medium payloads gzip may be the better trade — tune `threshold` accordingly. Benchmark with **your** data before assuming a win.
- The CLI location is detected once per process and cached.
- Compression runs asynchronously and does not block the event loop.

## Troubleshooting

- **`X-OpenZL-Error` header present** — OpenZL failed; the response fell back to gzip. Enable `debug: true` to see why.
- **No compression at all** — response below `threshold`, or client sent no usable `Accept-Encoding`.
- **`zli: no OpenZL binary available for <platform>`** — no prebuilt binary for your OS/arch; build from [facebook/openzl](https://github.com/facebook/openzl) or rely on gzip.

## Related

- [OpenZL](https://github.com/facebook/openzl) — the compression framework (Meta)
- [`@amirja811/openzl-cli`](https://www.npmjs.com/package/@amirja811/openzl-cli) — prebuilt `zli` binaries

## Disclaimer

This is an unofficial community package. It is not affiliated with or endorsed by Meta or the OpenZL project.

## License

MIT
