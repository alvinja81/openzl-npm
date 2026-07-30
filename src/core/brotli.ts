/**
 * Brotli helpers via Node core `zlib`.
 *
 * Quality note: zlib's brotli default is 11, which is meant for build-time
 * precompression of static assets — it is far too slow for per-request
 * encoding. Dynamic responses use quality 4 by default, the same choice other
 * HTTP compression middleware makes: roughly gzip's ratio at comparable speed.
 */

import * as zlib from 'zlib';
import { promisify } from 'util';
import type { Transform } from 'stream';

const hasBrotli =
  typeof zlib.brotliCompress === 'function' &&
  typeof zlib.brotliDecompress === 'function' &&
  typeof zlib.createBrotliCompress === 'function';

/** Quality used when no `brotliQuality` is given. */
export const DEFAULT_BROTLI_QUALITY = 4;

const unavailable = async (): Promise<Buffer> => {
  throw new Error('brotli not available in this Node build');
};

const brotliCompressAsync = hasBrotli
  ? (promisify(zlib.brotliCompress) as (
      buf: Buffer,
      opts?: zlib.BrotliOptions
    ) => Promise<Buffer>)
  : unavailable;

const brotliDecompressAsync = hasBrotli
  ? (promisify(zlib.brotliDecompress) as (buf: Buffer) => Promise<Buffer>)
  : unavailable;

/** True when Node zlib exposes brotli compress/decompress. */
export const isBrotliAvailable = (): boolean => hasBrotli;

const brotliParams = (
  quality: number | undefined,
  sizeHint?: number
): zlib.BrotliOptions => {
  const params: Record<number, number> = {
    [zlib.constants.BROTLI_PARAM_QUALITY]: quality ?? DEFAULT_BROTLI_QUALITY
  };
  // Free ratio win when the full length is known up front.
  if (sizeHint !== undefined && sizeHint > 0) {
    params[zlib.constants.BROTLI_PARAM_SIZE_HINT] = sizeHint;
  }
  return { params };
};

/**
 * Compress bytes with brotli.
 * @param quality 0–11 (default {@link DEFAULT_BROTLI_QUALITY})
 */
export const compressBrotli = (
  buffer: Buffer,
  quality?: number
): Promise<Buffer> => {
  if (!hasBrotli) {
    return Promise.reject(new Error('brotli not available in this Node build'));
  }
  return brotliCompressAsync(buffer, brotliParams(quality, buffer.length));
};

/** Decompress a brotli stream. */
export const decompressBrotli = (buffer: Buffer): Promise<Buffer> =>
  brotliDecompressAsync(buffer);

/**
 * Streaming brotli Transform.
 * @throws if brotli streams are unavailable
 */
export const createBrotliStream = (quality?: number): Transform => {
  if (!hasBrotli) {
    throw new Error('brotli not available in this Node build');
  }
  return zlib.createBrotliCompress(brotliParams(quality)) as Transform;
};
