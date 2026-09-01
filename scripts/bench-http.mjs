/**
 * HTTP-path middleware bench (not just codec-in-process).
 *
 *   node scripts/bench-http.mjs
 *
 * Starts Express with openzlMiddleware, hits gzip / br / zstd / openzl,
 * writes bench/results/middleware.md
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import zlib from 'zlib';
import {
  openzlMiddleware,
  decompress,
  decompressZstd,
  decompressBrotli,
  isZstdAvailable,
  isBrotliAvailable,
  isNativeAvailable,
  getActiveBackend
} from '../dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const payload = Buffer.from(
  JSON.stringify({
    items: Array.from({ length: 800 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      email: `u${i % 20}@ex.com`,
      ts: 1_700_000_000 + i
    }))
  })
);

const app = express();
app.use(openzlMiddleware({ threshold: 256, profile: 'api-list' }));
app.get('/t', (_req, res) => {
  res.type('json').send(payload);
});

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const { port } = server.address();

const request = (accept) =>
  new Promise((resolve, reject) => {
    const t0 = performance.now();
    http
      .get(
        {
          host: '127.0.0.1',
          port,
          path: '/t',
          headers: { 'Accept-Encoding': accept }
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              ce: res.headers['content-encoding'] || 'identity',
              body: Buffer.concat(chunks),
              ms: performance.now() - t0
            })
          );
        }
      )
      .on('error', reject);
  });

const cases = [{ name: 'gzip', accept: 'gzip', decode: (b) => zlib.gunzipSync(b) }];
if (isBrotliAvailable()) {
  cases.push({ name: 'br', accept: 'br', decode: (b) => decompressBrotli(b) });
}
if (isZstdAvailable()) {
  cases.push({ name: 'zstd', accept: 'zstd', decode: (b) => decompressZstd(b) });
}
const backend = await getActiveBackend();
if (backend !== 'unavailable' || isNativeAvailable()) {
  cases.push({ name: 'openzl', accept: 'openzl', decode: (b) => decompress(b) });
}

const rows = [];
for (const c of cases) {
  // warmup
  await request(c.accept);
  const samples = [];
  for (let i = 0; i < 7; i++) samples.push(await request(c.accept));
  const last = samples[samples.length - 1];
  const plain = await c.decode(last.body);
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)];
  rows.push({
    codec: last.ce,
    bytes: last.body.length,
    ratioPct: +((last.body.length / payload.length) * 100).toFixed(2),
    p50Ms: +p50.toFixed(2),
    roundtrip: Buffer.compare(Buffer.from(plain), payload) === 0
  });
}

server.close();

const lines = [
  '# Middleware HTTP bench',
  '',
  `Node ${process.version} · ${process.platform}/${process.arch}`,
  `Payload ${payload.length} bytes (JSON list, Express \`openzlMiddleware\`).`,
  'Times are end-to-end localhost (encode + transfer + decode), p50 of 7 after 1 warmup.',
  '',
  '| Codec | Bytes | Ratio | p50 | Roundtrip |',
  '|-------|------:|------:|----:|:----------|'
];
for (const r of rows) {
  lines.push(
    `| ${r.codec} | ${r.bytes} | ${r.ratioPct}% | ${r.p50Ms} ms | ${r.roundtrip ? 'ok' : 'FAIL'} |`
  );
}
lines.push('');

const outDir = path.join(root, 'bench/results');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'middleware.md');
fs.writeFileSync(outFile, lines.join('\n'));
console.log(lines.join('\n'));
console.log(`wrote ${outFile}`);

if (rows.some((r) => !r.roundtrip)) process.exit(1);
