# Migrating from `compression` / `@fastify/compress`

`openzl-express` is a **behavioral cousin**, not an options-compatible drop-in. gzip, brotli, and zstd work without OpenZL. OpenZL is opt-in and stays off for browsers.

Also Fastify and core: `openzl-express/fastify`, `openzl-express/core`.

## Express (`compression`)

```js
// before
import compression from 'compression';
app.use(compression());

// after
import { openzlMiddleware } from 'openzl-express/express';
app.use(openzlMiddleware({ threshold: 1024 }));
```

| `compression` | `openzl-express` |
|---------------|------------------|
| `threshold` (default 1kb) | `threshold` (default **1024**) |
| `filter` | `filter` |
| zlib `level` / `memLevel` / `strategy` | not exposed — gzip uses Node zlib defaults |
| brotli options bag | `allowBrotli`, `brotliQuality` (**default 4**, not zlib's 11) |
| — | `allowZstd`, `zstdLevel` |
| — | `profile` / `selectProfile` (OpenZL only) |

### Negotiation differences

| Client sends | `compression` (typical) | this package |
|--------------|-------------------------|--------------|
| `gzip, deflate, br` | brotli or gzip depending on version | **br** |
| `gzip, deflate, br, zstd` | often still br | **zstd** (Node ≥ ~22.15) |
| `*` | gzip | **gzip only** (never br, zstd, or openzl) |
| `openzl` | ignored | **openzl** if a backend is installed |

`Accept-Encoding: *` is gzip on purpose so old clients never receive br/zstd/openzl.

Do **not** stack this with `compression()` on the same app — double-encoding.

## Fastify (`@fastify/compress`)

```js
import Fastify from 'fastify';
import { openzlFastify } from 'openzl-express/fastify';

const app = Fastify();
await app.register(openzlFastify, { threshold: 1024 });
```

The plugin is registered with `fastify-plugin` and **breaks encapsulation** so parent routes get `onSend`. Same as most global compress plugins.

| `@fastify/compress` | `openzl-fastify` |
|---------------------|------------------|
| Streams gzip/br | **Streams gzip/br/zstd** when `reply.send` is a Node `Readable` |
| JSON/string bodies | Buffered, then compressed (same as a finished body) |
| OpenZL | Buffered only — no stream encoder |
| 204 / 205 / 304 / 206 | Not re-encoded |

Do not stack with `@fastify/compress`.

## What you can skip

Leave `profile` unset (`serial` is the OpenZL default and is unused unless the client sends `openzl`). A public API that only talks to browsers needs **no OpenZL config**.

See [FLAGSHIP.md](./FLAGSHIP.md) when you later train on shaped data.
