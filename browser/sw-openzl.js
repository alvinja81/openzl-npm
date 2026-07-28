/**
 * Optional Service Worker: intercepts fetches and decodes OpenZL responses.
 *
 * Register from your app:
 *   navigator.serviceWorker.register('/sw-openzl.js');
 *
 * Expects openzl_decode.js / .wasm next to this script (same directory)
 * or set self.OPENZL_WASM_BASE = '/path/to/browser/dist/';
 *
 * Clients should send: Accept-Encoding: openzl, gzip
 */

/* eslint-disable no-restricted-globals */

const BASE = self.OPENZL_WASM_BASE || './dist/';

let decoderPromise = null;

async function getDecoder() {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      const glueUrl = new URL('openzl_decode.js', new URL(BASE, self.location.href)).href;
      const wasmUrl = new URL('openzl_decode.wasm', new URL(BASE, self.location.href)).href;
      const mod = await import(glueUrl);
      const createOpenZL = mod.default;
      const Module = await createOpenZL({
        locateFile: (p) => (p.endsWith('.wasm') ? wasmUrl : p)
      });

      const bi = (n) => BigInt(n);
      const num = (x) => (typeof x === 'bigint' ? Number(x) : Number(x));

      return {
        decompress(frame) {
          const srcPtr = Module._malloc(frame.byteLength);
          try {
            Module.HEAPU8.set(frame, num(srcPtr));
            const size = num(
              Module._openzl_get_decompressed_size(bi(srcPtr), bi(frame.byteLength))
            );
            if (!size) throw new Error('openzl size failed');
            const dstPtr = Module._malloc(size);
            const outLenPtr = Module._malloc(8);
            try {
              const rc = Module._openzl_decompress(
                bi(srcPtr),
                bi(frame.byteLength),
                bi(dstPtr),
                bi(size),
                bi(outLenPtr)
              );
              if (Number(rc) !== 0) throw new Error('openzl decompress failed');
              const written = num(Module.getValue(outLenPtr, 'i64'));
              return new Uint8Array(
                Module.HEAPU8.subarray(num(dstPtr), num(dstPtr) + written)
              ).slice();
            } finally {
              Module._free(dstPtr);
              Module._free(outLenPtr);
            }
          } finally {
            Module._free(srcPtr);
          }
        }
      };
    })();
  }
  return decoderPromise;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(handleFetch(event.request));
});

async function handleFetch(request) {
  // Only intercept same-origin GETs by default to avoid CORS surprises
  if (request.method !== 'GET') {
    return fetch(request);
  }

  const res = await fetch(request);
  const enc = (res.headers.get('content-encoding') || '').toLowerCase();
  if (!enc.split(',').some((s) => s.trim() === 'openzl')) {
    return res;
  }

  try {
    const decoder = await getDecoder();
    const compressed = new Uint8Array(await res.arrayBuffer());
    const plain = decoder.decompress(compressed);
    const headers = new Headers(res.headers);
    headers.delete('content-encoding');
    headers.set('content-length', String(plain.byteLength));
    headers.set('x-openzl-decoded', 'sw');
    return new Response(plain, {
      status: res.status,
      statusText: res.statusText,
      headers
    });
  } catch (err) {
    console.error('[openzl-sw] decode failed, returning raw response', err);
    return res;
  }
}
