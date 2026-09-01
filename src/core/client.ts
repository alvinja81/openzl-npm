/**
 * Node/undici fetch helper: opt in to OpenZL and decode it.
 *
 * gzip / br / zstd stay with the runtime (Node fetch already inflates them).
 * OpenZL is not a native encoding, so we inflate those bodies ourselves.
 */

import { decompress } from './engine.js';

const DEFAULT_ACCEPT = 'openzl, zstd, br, gzip';

export type OpenZLFetch = typeof globalThis.fetch;

export type CreateOpenZLFetchOptions = {
  /** Defaults to global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /**
   * Sent when the caller did not set `Accept-Encoding`.
   * @default 'openzl, zstd, br, gzip'
   */
  acceptEncoding?: string;
};

const contentEncoding = (res: Response): string =>
  (res.headers.get('content-encoding') ?? '').split(',')[0].trim().toLowerCase();

/**
 * If `Content-Encoding` is `openzl`, decompress and return a new Response
 * whose body is identity bytes (encoding header stripped). Other encodings
 * pass through unchanged.
 */
export const decodeOpenZLResponse = async (res: Response): Promise<Response> => {
  if (contentEncoding(res) !== 'openzl') return res;
  const buf = Buffer.from(await res.arrayBuffer());
  const plain = await decompress(buf);
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.set('content-length', String(plain.byteLength));
  return new Response(new Uint8Array(plain), {
    status: res.status,
    statusText: res.statusText,
    headers
  });
};

/**
 * Wrap `fetch` so Node clients can speak OpenZL without hand-rolling headers
 * and `decompress()`.
 *
 *   const fetchZ = createOpenZLFetch();
 *   const res = await fetchZ('http://127.0.0.1:3000/api/metrics');
 *   const json = await res.json();
 */
export const createOpenZLFetch = (
  options: CreateOpenZLFetchOptions = {}
): OpenZLFetch => {
  const base = options.fetch ?? globalThis.fetch.bind(globalThis);
  const defaultAccept = options.acceptEncoding ?? DEFAULT_ACCEPT;

  const wrapped: OpenZLFetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('accept-encoding')) {
      headers.set('Accept-Encoding', defaultAccept);
    }
    const res = await base(input, { ...init, headers });
    return decodeOpenZLResponse(res);
  };

  return wrapped;
};
