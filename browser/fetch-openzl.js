/**
 * Transparent fetch wrapper: decodes `Content-Encoding: openzl` responses.
 *
 *   import { createOpenZLFetch } from './fetch-openzl.js';
 *   const fetchOzl = await createOpenZLFetch();
 *   const res = await fetchOzl('/api/data', { headers: { 'Accept-Encoding': 'openzl, gzip' } });
 *   const json = await res.json();
 */

import { createDecoder } from './openzl-decoder.js';

/**
 * @param {object} [options] - passed to createDecoder + optional `baseFetch`
 * @returns {Promise<typeof fetch>}
 */
export async function createOpenZLFetch(options = {}) {
  const decoder = await createDecoder(options);
  const baseFetch = options.baseFetch ?? globalThis.fetch.bind(globalThis);

  return async function openzlFetch(input, init) {
    const res = await baseFetch(input, init);
    const encoding = (res.headers.get('content-encoding') || '')
      .split(',')
      .map((s) => s.trim().toLowerCase());

    if (!encoding.includes('openzl')) {
      return res;
    }

    const compressed = new Uint8Array(await res.arrayBuffer());
    const t0 = performance.now();
    const plain = decoder.decompress(compressed);
    const decodeMs = performance.now() - t0;

    // Rebuild a Response as if it were uncompressed
    const headers = new Headers(res.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.set('content-length', String(plain.byteLength));
    headers.set('x-openzl-decoded', '1');
    headers.set('x-openzl-decode-ms', decodeMs.toFixed(3));
    headers.set('x-openzl-compressed-size', String(compressed.byteLength));

    return new Response(plain, {
      status: res.status,
      statusText: res.statusText,
      headers
    });
  };
}
