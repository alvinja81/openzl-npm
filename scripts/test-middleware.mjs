/**
 * Phase 5 smoke tests: res.json / res.send / stream / sendFile + encodings.
 *   npm run build && node scripts/test-middleware.mjs
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import {
  openzlMiddleware,
  decompress,
  decompressZstd,
  isZstdAvailable,
  isNativeAvailable,
  getActiveBackend,
  pickEncoding
} from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tmpFile = path.join(root, 'tmp-phase5-static.json');

const app = express();
app.use(
  openzlMiddleware({
    threshold: 100,
    debug: false,
    preferStreamGzip: true
  })
);

const big = {
  items: Array.from({ length: 200 }, (_, i) => ({
    id: i,
    name: `item-${i}`,
    email: `u${i % 20}@ex.com`
  }))
};
const bigJson = JSON.stringify(big);

app.get('/json', (_req, res) => {
  res.json(big);
});

app.get('/send', (_req, res) => {
  res.type('json').send(bigJson);
});

app.get('/stream', (_req, res) => {
  res.type('json');
  // multi-chunk write
  const mid = Math.floor(bigJson.length / 2);
  res.write(bigJson.slice(0, mid));
  res.write(bigJson.slice(mid));
  res.end();
});

app.get('/file', (_req, res) => {
  res.sendFile(tmpFile);
});

fs.writeFileSync(tmpFile, bigJson);

function request(port, urlPath, acceptEncoding) {
  return new Promise((resolve, reject) => {
    http
      .get(
        {
          host: '127.0.0.1',
          port,
          path: urlPath,
          headers: { 'Accept-Encoding': acceptEncoding }
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks)
            });
          });
        }
      )
      .on('error', reject);
  });
}

const server = app.listen(0, async () => {
  const port = server.address().port;
  let failed = 0;
  const backend = await getActiveBackend();
  const openzlOk = backend !== 'unavailable' || isNativeAvailable();
  console.log(
    `backend=${backend} native=${isNativeAvailable()} openzlTests=${openzlOk ? 'on' : 'skip'}`
  );

  const check = async (name, pathName, accept, expectEncoding, decode) => {
    const r = await request(port, pathName, accept);
    const ce = r.headers['content-encoding'];
    let ok = true;
    let detail = '';
    if (expectEncoding === null) {
      if (ce && ce !== 'identity') {
        ok = false;
        detail = `unexpected encoding ${ce}`;
      }
    } else if (ce !== expectEncoding) {
      ok = false;
      detail = `encoding ${ce} != ${expectEncoding}`;
    }
    if (ok && decode) {
      try {
        const plain = await decode(r.body);
        const text = plain.toString('utf8');
        if (!text.includes('item-0')) {
          ok = false;
          detail = 'payload missing expected content';
        }
      } catch (e) {
        ok = false;
        detail = e.message;
      }
    }
    console.log(ok ? '✓' : '✗', name, ce || 'identity', r.body.length, detail);
    if (!ok) failed++;
  };

  try {
    // Heroes always required
    await check('json+gzip', '/json', 'gzip', 'gzip', (b) =>
      Promise.resolve(zlib.gunzipSync(b))
    );
    await check('stream+gzip', '/stream', 'gzip', 'gzip', (b) =>
      Promise.resolve(zlib.gunzipSync(b))
    );
    await check('small identity', '/json', 'identity', null, async (b) => b);

    // OpenZL path only when native or zli is present (optionalDependency)
    if (openzlOk) {
      await check('json+openzl', '/json', 'openzl, gzip', 'openzl', decompress);
      await check('send+openzl', '/send', 'openzl', 'openzl', decompress);
      await check('stream+openzl', '/stream', 'openzl', 'openzl', decompress);
      // file + openzl,gzip with preferStreamGzip → gzip
      await check('file+openzl,gzip', '/file', 'openzl, gzip', 'gzip', (b) =>
        Promise.resolve(zlib.gunzipSync(b))
      );
      await check('file+openzl-only', '/file', 'openzl', 'openzl', decompress);
    } else {
      console.log('⊘ openzl backend unavailable — skip openzl cases (gzip/zstd heroes only)');
      // Without openzl, openzl+gzip should still land on gzip fallback
      await check('json+openzl→gzip fallback', '/json', 'openzl, gzip', 'gzip', (b) =>
        Promise.resolve(zlib.gunzipSync(b))
      );
    }

    // Phase 7: zstd peer
    if (isZstdAvailable()) {
      await check('json+zstd', '/json', 'zstd', 'zstd', decompressZstd);
      await check('json+zstd,gzip', '/json', 'zstd, gzip', 'zstd', decompressZstd);
      await check('stream+zstd', '/stream', 'zstd', 'zstd', decompressZstd);
      if (openzlOk) {
        await check(
          'openzl beats zstd when both',
          '/json',
          'openzl, zstd, gzip',
          'openzl',
          decompress
        );
      } else {
        // Prefer openzl in negotiate, but middleware falls back to zstd when encode fails
        await check(
          'openzl fail → zstd fallback',
          '/json',
          'openzl, zstd, gzip',
          'zstd',
          decompressZstd
        );
      }
      // negotiate unit checks
      if (pickEncoding('zstd, gzip') !== 'zstd') {
        console.log('✗ pickEncoding zstd prefer');
        failed++;
      } else {
        console.log('✓ pickEncoding zstd prefer');
      }
      if (pickEncoding('*') !== 'gzip') {
        console.log('✗ pickEncoding * is gzip not zstd', pickEncoding('*'));
        failed++;
      } else {
        console.log('✓ pickEncoding * → gzip (not zstd)');
      }
      if (pickEncoding('gzip, deflate, br') !== 'gzip') {
        console.log('✗ pickEncoding browser-like', pickEncoding('gzip, deflate, br'));
        failed++;
      } else {
        console.log('✓ pickEncoding browser-like → gzip');
      }
    } else {
      console.log('⊘ zstd unavailable — skip zstd cases');
    }

    if (failed) {
      console.error(`\n${failed} failed`);
      process.exitCode = 1;
    } else {
      console.log('\nall passed');
    }
  } finally {
    server.close();
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
});
