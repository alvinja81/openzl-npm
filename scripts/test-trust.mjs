/**
 * Phase 11 trust tests: limits, structured errors, onCompress, interop, malformed.
 *   npm run build && node scripts/test-trust.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';
import {
  compress,
  decompress,
  compressBody,
  LimitError,
  DecompressionError,
  CompressionError,
  isOpenZLError,
  isNativeAvailable,
  getActiveBackend,
  shutdownOpenZL,
  DEFAULT_MAX_INPUT_BYTES
} from '../dist/index.js';
import { openzlMiddleware } from '../dist/express.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixturesDir = path.join(root, 'test', 'fixtures', 'goldens');

let passed = 0;
let failed = 0;

const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};
const fail = (name, err) => {
  failed++;
  console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
};

const sampleJson = Buffer.from(
  JSON.stringify({
    items: Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      value: i * 1.5
    }))
  })
);

const openzlAvailable = async () => {
  const backend = await getActiveBackend();
  return backend !== 'unavailable' || isNativeAvailable();
};

async function testRoundtrip() {
  console.log('\n[interop] compress → decompress roundtrip');
  const backend = await getActiveBackend();
  console.log(`  backend: ${backend} (native=${isNativeAvailable()})`);

  if (!(await openzlAvailable())) {
    console.log('  ⊘ skip — no openzl backend (native/CLI)');
    ok('roundtrip skipped (no openzl backend)');
    return;
  }

  const zl = await compress(sampleJson, { profile: 'serial' });
  assert.ok(zl.length > 0, 'compressed non-empty');
  const raw = await decompress(zl);
  assert.deepStrictEqual(raw, sampleJson, 'roundtrip bytes match');
  ok(`serial roundtrip (${sampleJson.length} → ${zl.length} → ${raw.length})`);

  // Persist golden for offline interop checks
  fs.mkdirSync(fixturesDir, { recursive: true });
  const goldenPath = path.join(fixturesDir, 'serial-sample.zl');
  fs.writeFileSync(goldenPath, zl);
  const goldenMeta = {
    profile: 'serial',
    plainSha256: null,
    plainBytes: sampleJson.length,
    frameBytes: zl.length,
    plainUtf8: sampleJson.toString('utf8')
  };
  fs.writeFileSync(
    path.join(fixturesDir, 'serial-sample.json'),
    JSON.stringify(goldenMeta, null, 2)
  );

  // Reload golden and decode
  const fromDisk = fs.readFileSync(goldenPath);
  const decoded = await decompress(fromDisk);
  assert.deepStrictEqual(decoded, sampleJson);
  ok('golden reload decode');
}

async function testLimits() {
  console.log('\n[limits] maxInput / maxOutput');

  if (!(await openzlAvailable())) {
    // Input limit does not need a backend
    try {
      await decompress(Buffer.alloc(100, 1), { maxInputBytes: 1 });
      throw new Error('expected LimitError');
    } catch (err) {
      assert.ok(err instanceof LimitError);
      assert.strictEqual(err.code, 'INPUT_TOO_LARGE');
      ok('maxInputBytes without backend → LimitError');
    }
    console.log('  ⊘ skip output-limit (needs successful compress)');
    return;
  }

  const zl = await compress(sampleJson);

  // maxInputBytes: reject oversized compressed input before decode
  try {
    await decompress(zl, { maxInputBytes: 1 });
    throw new Error('expected LimitError for maxInputBytes');
  } catch (err) {
    assert.ok(err instanceof LimitError, `got ${err?.constructor?.name}`);
    assert.strictEqual(err.code, 'INPUT_TOO_LARGE');
    assert.ok(isOpenZLError(err));
    ok('maxInputBytes → LimitError INPUT_TOO_LARGE');
  }

  // maxOutputBytes: reject after decode if plain is too big
  try {
    await decompress(zl, { maxOutputBytes: 10 });
    throw new Error('expected LimitError for maxOutputBytes');
  } catch (err) {
    assert.ok(err instanceof LimitError, `got ${err?.constructor?.name}`);
    assert.strictEqual(err.code, 'OUTPUT_TOO_LARGE');
    ok('maxOutputBytes → LimitError OUTPUT_TOO_LARGE');
  }

  // Normal limits pass
  const okOut = await decompress(zl, {
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: 10 * 1024 * 1024
  });
  assert.deepStrictEqual(okOut, sampleJson);
  ok('defaults allow normal payload');
}

async function testMalformed() {
  console.log('\n[malformed] frames must not crash process');

  const cases = [
    ['empty', Buffer.alloc(0)],
    ['random-32', Buffer.from('not-an-openzl-frame-at-all!!!!!!')],
    ['truncated-magic', Buffer.from([0x28, 0xb5, 0x2f])], // zstd-ish garbage
    ['zeros-64', Buffer.alloc(64)],
    ['ff-64', Buffer.alloc(64, 0xff)],
    ['tiny-1', Buffer.from([0x00])]
  ];

  for (const [name, buf] of cases) {
    try {
      await decompress(buf, { timeoutMs: 5_000, maxInputBytes: 1_000_000 });
      // Some backends might return empty for empty? We reject empty.
      fail(name, 'decompress succeeded unexpectedly');
    } catch (err) {
      // Must be a structured error, never an uncaught native abort
      assert.ok(
        err instanceof Error,
        `${name}: expected Error, got ${typeof err}`
      );
      assert.ok(
        isOpenZLError(err) ||
          err instanceof CompressionError ||
          err instanceof DecompressionError ||
          err instanceof LimitError ||
          /OpenZL|zli|decompress|invalid|fail/i.test(err.message),
        `${name}: unexpected error shape ${err.name}: ${err.message}`
      );
      ok(`malformed ${name} → ${err.name || 'Error'} (no crash)`);
    }
  }
}

async function testOnCompress() {
  console.log('\n[metrics] onCompress hook');

  const events = [];
  const hasOpenzl = await openzlAvailable();

  // gzip path always works (hero)
  const gz = await compressBody(sampleJson, 'gzip', {
    threshold: 100,
    onCompress: (m) => events.push(m)
  });
  assert.strictEqual(gz.encoding, 'gzip');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].encoding, 'gzip');
  ok('gzip onCompress');

  events.length = 0;
  const result = await compressBody(sampleJson, 'openzl, gzip', {
    threshold: 100,
    profile: 'serial',
    onCompress: (m) => events.push(m)
  });

  if (hasOpenzl) {
    assert.strictEqual(result.encoding, 'openzl');
    assert.strictEqual(events.length, 1);
    const m = events[0];
    assert.strictEqual(m.encoding, 'openzl');
    assert.strictEqual(m.bytesIn, sampleJson.length);
    assert.strictEqual(m.bytesOut, result.body.length);
    assert.ok(typeof m.ms === 'number' && m.ms >= 0);
    assert.ok(typeof m.ratio === 'number' && m.ratio > 0);
    assert.strictEqual(m.profile, 'serial');
    ok(
      `compressBody onCompress encoding=${m.encoding} ratio=${m.ratio.toFixed(1)}% ms=${m.ms.toFixed(1)}`
    );
  } else {
    // Without backend, openzl request falls back to gzip/zstd
    assert.ok(
      result.encoding === 'gzip' || result.encoding === 'zstd',
      `expected hero fallback, got ${result.encoding}`
    );
    assert.ok(events.length >= 1);
    ok(`compressBody openzl→${result.encoding} fallback onCompress`);
  }

  // Express middleware path
  events.length = 0;
  const app = express();
  app.use(
    openzlMiddleware({
      threshold: 100,
      onCompress: (m) => events.push(m)
    })
  );
  app.get('/m', (_req, res) => {
    res.type('json').send(sampleJson.toString());
  });

  await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const port = server.address().port;
        const accept = hasOpenzl ? 'openzl' : 'gzip';
        await new Promise((res, rej) => {
          http
            .get(
              {
                host: '127.0.0.1',
                port,
                path: '/m',
                headers: { 'Accept-Encoding': accept }
              },
              (r) => {
                r.resume();
                r.on('end', res);
                r.on('error', rej);
              }
            )
            .on('error', rej);
        });
        assert.ok(events.length >= 1, 'middleware should emit onCompress');
        if (hasOpenzl) {
          assert.strictEqual(events[0].encoding, 'openzl');
        } else {
          assert.strictEqual(events[0].encoding, 'gzip');
        }
        ok(`middleware onCompress bytesIn=${events[0].bytesIn} enc=${events[0].encoding}`);
        server.close(() => resolve());
      } catch (e) {
        server.close(() => reject(e));
      }
    });
  });
}

async function testStructuredErrors() {
  console.log('\n[errors] structured codes');
  try {
    await decompress(Buffer.alloc(0));
  } catch (err) {
    assert.ok(err instanceof DecompressionError || err instanceof LimitError);
    assert.ok(err.code === 'INVALID_FRAME' || err.code === 'DECOMPRESSION_FAILED');
    ok(`empty input code=${err.code}`);
  }
}

async function main() {
  console.log('Phase 11 trust tests');
  try {
    await testRoundtrip();
  } catch (e) {
    fail('roundtrip', e);
  }
  try {
    await testLimits();
  } catch (e) {
    fail('limits', e);
  }
  try {
    await testMalformed();
  } catch (e) {
    fail('malformed suite', e);
  }
  try {
    await testOnCompress();
  } catch (e) {
    fail('onCompress', e);
  }
  try {
    await testStructuredErrors();
  } catch (e) {
    fail('structured errors', e);
  }

  await shutdownOpenZL().catch(() => {});

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
