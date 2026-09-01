/**
 * Flagship demo: metrics / time-series JSON with openzl vs zstd vs gzip.
 *
 * Serves real training samples from profiles/samples/timeseries/ (same shape
 * used by `npx openzl-train`). Prefers a locally trained .zlc when present:
 *
 *   npx openzl-train ../../profiles/samples/timeseries \
 *     -o ./trained-metrics.zlc -p serial --max-time 30
 *
 *   npm run build && node examples/flagship-metrics/server.mjs
 *
 * Endpoints:
 *   GET /                    HTML size table
 *   GET /api/metrics         negotiated body (openzl | zstd | gzip)
 *   GET /api/metrics/raw     uncompressed held-out sample (no middleware compress)
 *   GET /api/metrics/:id     sample-0 … sample-N from training corpus
 *   GET /api/compare         side-by-side codec sizes
 *   GET /api/health          backend + profile info
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const loadLib = async () => {
  try {
    return await import('openzl-express');
  } catch {
    return import(pathToFileURL(path.join(root, 'dist/index.js')).href);
  }
};

const {
  openzlMiddleware,
  compress,
  compressGzip,
  compressBrotli,
  compressZstd,
  isZstdAvailable,
  isBrotliAvailable,
  isNativeAvailable,
  getActiveBackend,
  decompress
} = await loadLib();

const PORT = Number(process.env.PORT) || 3456;

const samplesDir = path.join(root, 'profiles/samples/timeseries');
const trainedLocal = path.join(__dirname, 'trained-metrics.zlc');
const shippedProfile = 'timeseries';

/** Prefer demo-trained .zlc; fall back to shipped timeseries profile. */
const profile = fs.existsSync(trainedLocal) ? trainedLocal : shippedProfile;
const profileLabel = fs.existsSync(trainedLocal)
  ? 'trained-metrics.zlc (openzl-train)'
  : 'timeseries (shipped)';

const loadSampleFiles = () => {
  if (!fs.existsSync(samplesDir)) return [];
  return fs
    .readdirSync(samplesDir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => {
      const na = Number(a.match(/\d+/)?.[0] ?? 0);
      const nb = Number(b.match(/\d+/)?.[0] ?? 0);
      return na - nb;
    })
    .map((f) => path.join(samplesDir, f));
};

const sampleFiles = loadSampleFiles();

/** Held-out sample for the main API (last file if many; else synthetic). */
function loadPrimaryPayload() {
  if (sampleFiles.length > 0) {
    // Use last sample as held-out-ish; trainers used earlier ones
    const file = sampleFiles[sampleFiles.length - 1];
    const raw = fs.readFileSync(file);
    const json = JSON.parse(raw.toString('utf8'));
    // Enrich with demo metadata without changing core shape
    return {
      ...json,
      host: 'demo-1',
      source: path.relative(root, file),
      intervalMs: 1000
    };
  }
  // Fallback synthetic if samples missing
  const points = [];
  for (let i = 0; i < 400; i++) {
    points.push({
      t: 1_700_000_000 + i,
      sensor: `s${i % 8}`,
      temp: 20 + Math.sin(i / 17) * 5 + (i % 7) * 0.01,
      humidity: 40 + Math.cos(i / 23) * 10,
      pressure: 1013.25 + Math.sin(i / 41) * 2,
      battery: 100 - (i % 100) * 0.05
    });
  }
  return { series: 'env-v1', host: 'demo-1', intervalMs: 1000, points, source: 'synthetic' };
}

const payload = loadPrimaryPayload();
const plain = Buffer.from(JSON.stringify(payload));

const app = express();

const metricsLog = [];
app.use(
  openzlMiddleware({
    threshold: 256,
    profile,
    preferStreamGzip: true,
    onCompress: (m) => {
      metricsLog.push({ ...m, at: Date.now() });
      if (metricsLog.length > 50) metricsLog.shift();
    }
  })
);

/** Primary metrics API — same shape as training samples. */
app.get('/api/metrics', (_req, res) => {
  res.type('json').send(plain);
});

/** Individual corpus sample (for clients that want variety). */
app.get('/api/metrics/:id', (req, res) => {
  const id = String(req.params.id).replace(/[^0-9]/g, '');
  const file = path.join(samplesDir, `sample-${id}.json`);
  if (!fs.existsSync(file)) {
    res.status(404).json({
      error: 'sample not found',
      available: sampleFiles.map((f) => path.basename(f))
    });
    return;
  }
  res.type('json').send(fs.readFileSync(file));
});

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    flagship: 'metrics / time-series JSON',
    profile: profileLabel,
    profilePath: profile,
    samplesDir: path.relative(root, samplesDir),
    sampleCount: sampleFiles.length,
    primarySource: payload.source ?? 'unknown',
    plainBytes: plain.length,
    native: isNativeAvailable(),
    zstd: isZstdAvailable(),
    backend: await getActiveBackend({
      profile: typeof profile === 'string' && profile.endsWith('.zlc') ? profile : shippedProfile
    }),
    trainHint:
      'npx openzl-train profiles/samples/timeseries -o examples/flagship-metrics/trained-metrics.zlc -p serial'
  });
});

/** Side-by-side size table (no Accept-Encoding negotiation). */
app.get('/api/compare', async (_req, res) => {
  const t0 = performance.now();
  const zl = await compress(plain, { profile });
  const tZl = performance.now() - t0;

  const t1 = performance.now();
  const gz = await compressGzip(plain);
  const tGz = performance.now() - t1;

  let br = null;
  let tBr = null;
  if (isBrotliAvailable()) {
    const tB = performance.now();
    br = await compressBrotli(plain);
    tBr = performance.now() - tB;
  }

  let zstd = null;
  let tZstd = null;
  if (isZstdAvailable()) {
    const t2 = performance.now();
    zstd = await compressZstd(plain);
    tZstd = performance.now() - t2;
  }

  const back = await decompress(zl);
  const ok = Buffer.compare(back, plain) === 0;

  res.json({
    flagship: 'metrics / time-series JSON',
    profile: profileLabel,
    source: payload.source,
    plainBytes: plain.length,
    codecs: {
      openzl: {
        bytes: zl.length,
        ratioPct: +((zl.length / plain.length) * 100).toFixed(2),
        encodeMs: +tZl.toFixed(3)
      },
      gzip: {
        bytes: gz.length,
        ratioPct: +((gz.length / plain.length) * 100).toFixed(2),
        encodeMs: +tGz.toFixed(3)
      },
      br: br
        ? {
            bytes: br.length,
            ratioPct: +((br.length / plain.length) * 100).toFixed(2),
            encodeMs: +tBr.toFixed(3)
          }
        : { available: false },
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
    savingsVsBrBytes: br ? br.length - zl.length : null,
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
    Payload from <code>profiles/samples/timeseries/</code> · profile:
    <code>${profileLabel}</code>
  </p>
  <p>
    <a href="/api/compare">/api/compare</a> ·
    <a href="/api/metrics">/api/metrics</a> ·
    <a href="/api/health">/api/health</a> ·
    <a href="/api/metrics/0">/api/metrics/0</a>
  </p>
  <h2>Live compare</h2>
  <pre id="out">Loading /api/compare…</pre>
  <h2>curl</h2>
  <pre>curl -sH 'Accept-Encoding: openzl' -D- http://127.0.0.1:${PORT}/api/metrics -o /dev/null
curl -sH 'Accept-Encoding: zstd'  -D- http://127.0.0.1:${PORT}/api/metrics -o /dev/null
curl -sH 'Accept-Encoding: gzip'  -D- http://127.0.0.1:${PORT}/api/metrics -o /dev/null</pre>
  <p class="muted">Retrain: <code>npx openzl-train profiles/samples/timeseries -o examples/flagship-metrics/trained-metrics.zlc</code></p>
  <script>
    fetch('/api/compare').then(r => r.json()).then(d => {
      const c = d.codecs;
      const rows = [
        ['plain', d.plainBytes, '100%', '—'],
        ['openzl', c.openzl.bytes, c.openzl.ratioPct + '%', c.openzl.encodeMs + ' ms'],
        ['gzip', c.gzip.bytes, c.gzip.ratioPct + '%', c.gzip.encodeMs + ' ms'],
        ['br', c.br && c.br.bytes != null ? c.br.bytes : 'n/a', c.br && c.br.ratioPct != null ? c.br.ratioPct + '%' : '—', c.br && c.br.encodeMs != null ? c.br.encodeMs + ' ms' : '—'],
        ['zstd', c.zstd.bytes ?? 'n/a', (c.zstd.ratioPct != null ? c.zstd.ratioPct + '%' : '—'), c.zstd.encodeMs != null ? c.zstd.encodeMs + ' ms' : '—']
      ];
      let html = '<p class="muted">source: ' + (d.source || '') + ' · ' + d.profile + '</p>';
      html += '<table><tr><th>Codec</th><th>Bytes</th><th>Ratio</th><th>Encode</th></tr>';
      for (const [name, b, r, ms] of rows) {
        const cls = name === 'openzl' ? ' class="win"' : '';
        html += '<tr'+cls+'><td>'+name+'</td><td>'+b+'</td><td>'+r+'</td><td>'+ms+'</td></tr>';
      }
      html += '</table>';
      html += '<p>Savings vs gzip: <strong>' + d.savingsVsGzipBytes + '</strong> bytes';
      if (d.savingsVsBrBytes != null) html += ' · vs br: <strong>' + d.savingsVsBrBytes + '</strong> bytes';
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
  console.log(`  profile:  ${profileLabel}`);
  console.log(`  source:   ${payload.source}`);
  console.log(`  samples:  ${sampleFiles.length} under profiles/samples/timeseries`);
  console.log(`  plain:    ${plain.length} bytes`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
