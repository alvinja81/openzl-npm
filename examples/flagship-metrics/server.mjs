/**
 * Flagship demo: metrics / time-series JSON with openzl vs zstd vs gzip.
 *
 *   npm run build && node examples/flagship-metrics/server.mjs
 *
 * Then open http://127.0.0.1:3456/ or:
 *   curl -sH 'Accept-Encoding: openzl' -D- http://127.0.0.1:3456/api/metrics -o /tmp/m.zl
 *   curl -sH 'Accept-Encoding: zstd'  -D- http://127.0.0.1:3456/api/metrics -o /tmp/m.zst
 *   curl -sH 'Accept-Encoding: gzip'  -D- http://127.0.0.1:3456/api/metrics -o /tmp/m.gz
 */

import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  openzlMiddleware,
  compress,
  compressGzip,
  compressZstd,
  isZstdAvailable,
  decompress
} from '../../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3456;

/** Synthetic metrics payload (~same shape as profiles/samples/timeseries). */
function buildMetrics(points = 400) {
  const series = [];
  for (let i = 0; i < points; i++) {
    series.push({
      t: 1_700_000_000 + i,
      sensor: `s${i % 8}`,
      temp: 20 + Math.sin(i / 17) * 5 + (i % 7) * 0.01,
      humidity: 40 + Math.cos(i / 23) * 10,
      pressure: 1013.25 + Math.sin(i / 41) * 2,
      battery: 100 - (i % 100) * 0.05
    });
  }
  return {
    series: 'env-v1',
    host: 'demo-1',
    intervalMs: 1000,
    points: series
  };
}

const payload = buildMetrics();
const plain = Buffer.from(JSON.stringify(payload));

const app = express();

const metricsLog = [];
app.use(
  openzlMiddleware({
    threshold: 256,
    profile: 'timeseries',
    preferStreamGzip: true,
    onCompress: (m) => {
      metricsLog.push({ ...m, at: Date.now() });
      if (metricsLog.length > 50) metricsLog.shift();
    }
  })
);

app.get('/api/metrics', (_req, res) => {
  res.type('json').send(plain);
});

/** Side-by-side size table (no Accept-Encoding negotiation). */
app.get('/api/compare', async (_req, res) => {
  const t0 = performance.now();
  const zl = await compress(plain, { profile: 'timeseries' });
  const tZl = performance.now() - t0;

  const t1 = performance.now();
  const gz = await compressGzip(plain);
  const tGz = performance.now() - t1;

  let zstd = null;
  let tZstd = null;
  if (isZstdAvailable()) {
    const t2 = performance.now();
    zstd = await compressZstd(plain);
    tZstd = performance.now() - t2;
  }

  // Verify OpenZL roundtrip
  const back = await decompress(zl);
  const ok = Buffer.compare(back, plain) === 0;

  res.json({
    flagship: 'metrics / time-series JSON',
    plainBytes: plain.length,
    codecs: {
      openzl_timeseries: {
        bytes: zl.length,
        ratioPct: +((zl.length / plain.length) * 100).toFixed(2),
        encodeMs: +tZl.toFixed(3)
      },
      gzip: {
        bytes: gz.length,
        ratioPct: +((gz.length / plain.length) * 100).toFixed(2),
        encodeMs: +tGz.toFixed(3)
      },
      zstd: zstd
        ? {
            bytes: zstd.length,
            ratioPct: +((zstd.length / plain.length) * 100).toFixed(2),
            encodeMs: +tZstd.toFixed(3)
          }
        : { available: false }
    },
    roundtripOk: ok,
    savingsVsGzipBytes: gz.length - zl.length,
    savingsVsZstdBytes: zstd ? zstd.length - zl.length : null,
    recentOnCompress: metricsLog.slice(-5)
  });
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>openzl-express — metrics flagship</title>
  <style>
    :root { font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; }
    body { max-width: 52rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    h1 { font-size: 1.35rem; }
    code, pre { background: #f1f5f9; border-radius: 6px; }
    code { padding: 0.1em 0.35em; }
    pre { padding: 1rem; overflow: auto; font-size: 0.85rem; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #cbd5e1; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f8fafc; }
    .win { color: #047857; font-weight: 600; }
    .muted { color: #64748b; font-size: 0.9rem; }
    a { color: #0369a1; }
  </style>
</head>
<body>
  <h1>Flagship: metrics / time-series JSON</h1>
  <p class="muted">
    Server uses <code>profile: 'timeseries'</code>. Browsers get gzip/zstd only unless they send
    <code>Accept-Encoding: openzl</code> (Node clients / internal tools).
  </p>
  <p>
    <a href="/api/compare">/api/compare</a> — JSON size table ·
    <a href="/api/metrics">/api/metrics</a> — negotiated body
  </p>
  <h2>Live compare</h2>
  <pre id="out">Loading /api/compare…</pre>
  <h2>curl</h2>
  <pre>curl -sH 'Accept-Encoding: openzl' -D- http://127.0.0.1:${PORT}/api/metrics -o /dev/null
curl -sH 'Accept-Encoding: zstd'  -D- http://127.0.0.1:${PORT}/api/metrics -o /dev/null
curl -sH 'Accept-Encoding: gzip'  -D- http://127.0.0.1:${PORT}/api/metrics -o /dev/null</pre>
  <p class="muted">Docs: <code>docs/FLAGSHIP.md</code></p>
  <script>
    fetch('/api/compare').then(r => r.json()).then(d => {
      const c = d.codecs;
      const rows = [
        ['plain', d.plainBytes, '100%', '—'],
        ['openzl (timeseries)', c.openzl_timeseries.bytes, c.openzl_timeseries.ratioPct + '%', c.openzl_timeseries.encodeMs + ' ms'],
        ['gzip', c.gzip.bytes, c.gzip.ratioPct + '%', c.gzip.encodeMs + ' ms'],
        ['zstd', c.zstd.bytes ?? 'n/a', (c.zstd.ratioPct != null ? c.zstd.ratioPct + '%' : '—'), c.zstd.encodeMs != null ? c.zstd.encodeMs + ' ms' : '—']
      ];
      let html = '<table><tr><th>Codec</th><th>Bytes</th><th>Ratio</th><th>Encode</th></tr>';
      for (const [name, b, r, ms] of rows) {
        const cls = name.startsWith('openzl') ? ' class="win"' : '';
        html += '<tr'+cls+'><td>'+name+'</td><td>'+b+'</td><td>'+r+'</td><td>'+ms+'</td></tr>';
      }
      html += '</table>';
      html += '<p>Savings vs gzip: <strong>' + d.savingsVsGzipBytes + '</strong> bytes';
      if (d.savingsVsZstdBytes != null) html += ' · vs zstd: <strong>' + d.savingsVsZstdBytes + '</strong> bytes';
      html += '</p><pre>' + JSON.stringify(d, null, 2) + '</pre>';
      document.getElementById('out').outerHTML = html;
    }).catch(e => { document.getElementById('out').textContent = String(e); });
  </script>
</body>
</html>`);
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Flagship metrics demo → http://127.0.0.1:${PORT}/`);
  console.log(`  compare JSON:        http://127.0.0.1:${PORT}/api/compare`);
  console.log(`  plain payload:       ${plain.length} bytes`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
