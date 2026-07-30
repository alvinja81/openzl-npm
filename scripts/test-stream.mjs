/**
 * Phase 2 tests: streaming robustness.
 *   - backpressure reaches the producer (slow client must not make us buffer)
 *   - integrity of a large compressed body read slowly
 *   - client abort mid-stream does not crash the server
 *   - double end() / write-after-end are harmless
 *
 *   npm run build && node scripts/test-stream.mjs
 */
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import zlib from 'zlib';
import { Readable } from 'stream';
import { openzlMiddleware, decompressZstd, isZstdAvailable } from '../dist/index.js';

const CHUNK = 64 * 1024;
const CHUNKS = 384; // 24 MiB
const TOTAL = CHUNK * CHUNKS;
const STALL_MS = 1200;
/** Buffered-in-flight allowance while the client refuses to read. */
const MAX_IN_FLIGHT = 12 * 1024 * 1024;

let failed = 0;
const ok = (name, pass, detail = '', alwaysShowDetail = false) => {
  console.log(pass ? '✓' : '✗', name, !pass || alwaysShowDetail ? detail : '');
  if (!pass) failed++;
};

const fatal = [];
process.on('uncaughtException', (e) => fatal.push(`uncaught: ${e.message}`));
process.on('unhandledRejection', (e) => fatal.push(`unhandled: ${e?.message ?? e}`));

const app = express();
app.use(
  openzlMiddleware({
    threshold: 1024,
    // Random payloads are sent as octet-stream; compress them anyway so the
    // codec output stays roughly as large as the input.
    filter: () => true
  })
);

let pushed = 0;
let sourceHash = null;

app.get('/big', (_req, res) => {
  pushed = 0;
  const hash = crypto.createHash('sha256');
  let n = 0;
  let done = false;
  const source = new Readable({
    read() {
      if (done) return;
      if (n++ >= CHUNKS) {
        done = true;
        sourceHash = hash.digest('hex');
        this.push(null);
        return;
      }
      const buf = crypto.randomBytes(CHUNK);
      hash.update(buf);
      pushed += buf.length;
      this.push(buf);
    }
  });
  source.on('error', (e) => fatal.push(`source: ${e.message}`));
  res.type('application/octet-stream');
  source.pipe(res);
});

app.get('/double-end', (_req, res) => {
  const body = 'x'.repeat(4096);
  res.type('text/plain');
  res.end(body);
  res.end(); // second end must be a no-op
  res.write('after-end'); // must not throw or corrupt the body
});

app.get('/abortable', (_req, res) => {
  res.type('text/plain');
  const iv = setInterval(() => res.write('y'.repeat(8192)), 20);
  res.on('close', () => clearInterval(iv));
  setTimeout(() => {
    clearInterval(iv);
    if (!res.writableEnded) res.end();
  }, 3000);
});

const get = (port, path, headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      })
      .on('error', reject);
  });

// A stalled response is a failure, not a reason to hang CI.
const watchdog = setTimeout(() => {
  console.error('✗ stream tests timed out (response never completed)');
  process.exit(1);
}, 60000);
watchdog.unref?.();

const server = app.listen(0, async () => {
  const port = server.address().port;
  try {
    // 1 + 2: a client that stops reading must stall the producer, and the body
    // must still arrive intact once it resumes.
    const slow = await new Promise((resolve, reject) => {
      http
        .get(
          { host: '127.0.0.1', port, path: '/big', headers: { 'Accept-Encoding': 'gzip' } },
          (res) => {
            res.pause();
            setTimeout(() => {
              const inFlight = pushed;
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () =>
                resolve({
                  ce: res.headers['content-encoding'],
                  inFlight,
                  body: Buffer.concat(chunks)
                })
              );
              res.resume();
            }, STALL_MS);
          }
        )
        .on('error', reject);
    });

    ok('big body compressed', slow.ce === 'gzip', `encoding=${slow.ce}`);
    ok(
      'backpressure stalls producer while client is paused',
      slow.inFlight < MAX_IN_FLIGHT,
      `${(slow.inFlight / 1048576).toFixed(1)} MiB pushed of ${TOTAL / 1048576} MiB after ${STALL_MS}ms`,
      true
    );

    const plain = zlib.gunzipSync(slow.body);
    ok('slow-read body length intact', plain.length === TOTAL, `${plain.length} != ${TOTAL}`);
    const got = crypto.createHash('sha256').update(plain).digest('hex');
    ok('slow-read body bytes intact', got === sourceHash);

    // zstd rides the same sink, so check its large-body integrity too
    if (isZstdAvailable()) {
      const z = await get(port, '/big', { 'Accept-Encoding': 'zstd' });
      const zPlain = await decompressZstd(z.body);
      ok('zstd large body intact', zPlain.length === TOTAL, `${zPlain.length} != ${TOTAL}`);
      const zHash = crypto.createHash('sha256').update(zPlain).digest('hex');
      ok('zstd large body bytes intact', zHash === sourceHash);
    } else {
      console.log('⊘ zstd unavailable — skip zstd large-body case');
    }

    // 3: client aborts mid-stream
    const aborted = await new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/abortable', headers: { 'Accept-Encoding': 'gzip' } },
        (res) => {
          res.once('data', () => {
            req.destroy();
            setTimeout(() => resolve(true), 300);
          });
        }
      );
      req.on('error', () => resolve(true));
    });
    ok('client abort handled', aborted && fatal.length === 0, fatal.join('; '));

    const after = await get(port, '/double-end', { 'Accept-Encoding': 'gzip' });
    ok('server alive after abort', after.status === 200);

    // 4 + 5: double end() and write-after-end
    ok('double end compressed once', after.headers['content-encoding'] === 'gzip');
    const dePlain = zlib.gunzipSync(after.body).toString();
    ok(
      'write-after-end does not corrupt body',
      dePlain === 'x'.repeat(4096),
      `len=${dePlain.length}`
    );
    ok('no unhandled errors', fatal.length === 0, fatal.join('; '));

    if (failed) {
      console.error(`\n${failed} failed`);
      process.exitCode = 1;
    } else {
      console.log('\nstream tests all passed');
    }
  } catch (err) {
    console.error('✗ stream tests threw:', err.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    server.close();
  }
});
