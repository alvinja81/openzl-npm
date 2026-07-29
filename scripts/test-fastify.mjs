/**
 * Phase 8 smoke: Fastify plugin multi-codec.
 * Uses http.get (not fetch) so Accept-Encoding is not rewritten by undici.
 */
import Fastify from 'fastify';
import http from 'http';
import zlib from 'zlib';
import {
  openzlFastify,
  decompress,
  decompressZstd,
  isZstdAvailable,
  isNativeAvailable,
  getActiveBackend
} from '../dist/index.js';

const big = {
  items: Array.from({ length: 200 }, (_, i) => ({
    id: i,
    name: `item-${i}`,
    email: `u${i % 20}@ex.com`
  }))
};

const app = Fastify({ logger: false });
await app.register(openzlFastify, { threshold: 100, debug: false });
app.get('/json', async () => big);
await app.listen({ port: 0, host: '127.0.0.1' });
const port = app.server.address().port;

function request(acceptEncoding) {
  return new Promise((resolve, reject) => {
    http
      .get(
        {
          host: '127.0.0.1',
          port,
          path: '/json',
          headers: { 'Accept-Encoding': acceptEncoding }
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              ce: res.headers['content-encoding'],
              body: Buffer.concat(chunks)
            })
          );
        }
      )
      .on('error', reject);
  });
}

async function check(name, accept, expectEnc, decode) {
  const r = await request(accept);
  let ok = r.ce === expectEnc;
  let detail = '';
  if (ok && decode) {
    try {
      const plain = await decode(r.body);
      if (!plain.toString().includes('item-0')) {
        ok = false;
        detail = 'bad payload';
      }
    } catch (e) {
      ok = false;
      detail = e.message;
    }
  } else if (!ok) {
    detail = `got ${r.ce}`;
  }
  console.log(ok ? '✓' : '✗', 'fastify', name, r.ce || 'identity', r.body.length, detail);
  return ok ? 0 : 1;
}

const backend = await getActiveBackend();
const openzlOk = backend !== 'unavailable' || isNativeAvailable();
console.log(
  `backend=${backend} native=${isNativeAvailable()} openzlTests=${openzlOk ? 'on' : 'skip'}`
);

let failed = 0;
// Heroes
failed += await check('gzip', 'gzip', 'gzip', async (b) => zlib.gunzipSync(b));
if (isZstdAvailable()) {
  failed += await check('zstd', 'zstd', 'zstd', decompressZstd);
}

if (openzlOk) {
  failed += await check('openzl', 'openzl', 'openzl', decompress);
  if (isZstdAvailable()) {
    failed += await check('openzl>zstd', 'openzl, zstd, gzip', 'openzl', decompress);
  }
} else {
  console.log('⊘ openzl backend unavailable — skip openzl cases');
  // openzl requested + gzip allowed → gzip fallback
  failed += await check(
    'openzl→gzip fallback',
    'openzl, gzip',
    'gzip',
    async (b) => zlib.gunzipSync(b)
  );
  if (isZstdAvailable()) {
    failed += await check(
      'openzl→zstd fallback',
      'openzl, zstd, gzip',
      'zstd',
      decompressZstd
    );
  }
}

await app.close();
if (failed) {
  console.error(failed, 'failed');
  process.exit(1);
}
console.log('fastify all passed');
