/**
 * Node fetch helper: createOpenZLFetch + decodeOpenZLResponse.
 * Uses http.get-backed fetch against a tiny server so Accept-Encoding is ours.
 */
import http from 'http';
import {
  createOpenZLFetch,
  decodeOpenZLResponse,
  compress,
  compressGzip,
  decompress,
  isNativeAvailable,
  getActiveBackend
} from '../dist/index.js';

const payload = Buffer.from(
  JSON.stringify({
    items: Array.from({ length: 80 }, (_, i) => ({ id: i, name: `item-${i}` }))
  })
);

const gz = await compressGzip(payload);
const backend = await getActiveBackend();
const openzlOk = backend !== 'unavailable' || isNativeAvailable();
let zl = null;
if (openzlOk) {
  try {
    zl = await compress(payload, { profile: 'serial' });
  } catch {
    zl = null;
  }
}

const server = http.createServer((req, res) => {
  const accept = String(req.headers['accept-encoding'] ?? '');
  if (req.url === '/metrics') {
    if (/\bopenzl\b/i.test(accept) && zl) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'openzl',
        'Content-Length': zl.length
      });
      res.end(zl);
      return;
    }
    if (/\bgzip\b/i.test(accept)) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': gz.length
      });
      res.end(gz);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(payload);
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(pass ? '✓' : '✗', name, detail);
  if (!pass) failed++;
};

const fetchZ = createOpenZLFetch();

{
  const res = await fetchZ(`${base}/metrics`, {
    headers: { 'Accept-Encoding': 'gzip' }
  });
  const text = await res.text();
  ok(
    'fetch helper gzip still decodes via runtime',
    res.ok && text.includes('item-0'),
    res.headers.get('content-encoding') ?? 'identity'
  );
}

if (zl) {
  const res = await fetchZ(`${base}/metrics`);
  const json = await res.json();
  ok(
    'fetch helper sends openzl and returns JSON',
    Array.isArray(json.items) && json.items[0].name === 'item-0',
    res.headers.get('content-encoding') ?? 'identity'
  );

  const raw = await fetch(`${base}/metrics`, {
    headers: { 'Accept-Encoding': 'openzl' }
  });
  const decoded = await decodeOpenZLResponse(raw);
  const round = await decompress(zl);
  ok('raw openzl frame roundtrips', round.equals(payload));
  ok(
    'decodeOpenZLResponse strips encoding',
    decoded.headers.get('content-encoding') == null &&
      (await decoded.text()).includes('item-0')
  );
} else {
  console.log('⊘ openzl backend unavailable — skip openzl fetch cases');
}

server.close();
if (failed) {
  console.error(failed, 'failed');
  process.exit(1);
}
console.log('client helper all passed');
