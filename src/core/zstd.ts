/**
 * Zstandard helpers via Node core `zlib` (when available).
 * Types are optional — older @types/node may not list zstd yet.
 */

import * as zlib from 'zlib';
import { promisify } from 'util';
import type { Transform } from 'stream';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const z = zlib as any;

const hasZstd =
  typeof z.zstdCompress === 'function' &&
  typeof z.zstdDecompress === 'function' &&
  typeof z.createZstdCompress === 'function';

const zstdCompressAsync = hasZstd
  ? (promisify(z.zstdCompress) as (
      buf: Buffer,
      opts?: object
    ) => Promise<Buffer>)
  : async (_buf: Buffer): Promise<Buffer> => {
      throw new Error('zstd not available in this Node build');
    };

const zstdDecompressAsync = hasZstd
  ? (promisify(z.zstdDecompress) as (buf: Buffer) => Promise<Buffer>)
  : async (_buf: Buffer): Promise<Buffer> => {
      throw new Error('zstd not available in this Node build');
    };

/** True when Node zlib exposes zstd compress/decompress. */
export const isZstdAvailable = (): boolean => hasZstd;

/**
 * Compress with zstd.
 */
export const compressZstd = (
  buffer: Buffer,
  level?: number
): Promise<Buffer> => {
  if (!hasZstd) {
    return Promise.reject(new Error('zstd not available in this Node build'));
  }
  if (level === undefined) {
    return zstdCompressAsync(buffer);
  }
  const levelKey = z.constants?.ZSTD_c_compressionLevel;
  if (levelKey === undefined) {
    return zstdCompressAsync(buffer);
  }
  return zstdCompressAsync(buffer, {
    params: { [levelKey]: level }
  });
};

/** Decompress zstd frame. */
export const decompressZstd = (buffer: Buffer): Promise<Buffer> =>
  zstdDecompressAsync(buffer);

/**
 * Streaming zstd Transform.
 * @throws if zstd streams unavailable
 */
export const createZstdStream = (level?: number): Transform => {
  if (!hasZstd) {
    throw new Error('zstd not available in this Node build');
  }
  if (level === undefined) {
    return z.createZstdCompress() as Transform;
  }
  const levelKey = z.constants?.ZSTD_c_compressionLevel;
  if (levelKey === undefined) {
    return z.createZstdCompress() as Transform;
  }
  return z.createZstdCompress({
    params: { [levelKey]: level }
  }) as Transform;
};
