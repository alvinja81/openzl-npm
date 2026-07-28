/**
 * Shared adapter helpers (framework-free compression of a finished body).
 */

import {
  compress,
  compressGzip,
  compressZstd,
  isZstdAvailable,
  pickEncoding,
  type ContentEncoding
} from '../core/index.js';

export const DEFAULT_COMPRESSIBLE_TYPE =
  /json|text|javascript|xml|svg|wasm|yaml|toml|csv|markdown|html/i;

export type SharedCodecOptions = {
  threshold?: number;
  fallbackToGzip?: boolean;
  profile?: string;
  allowZstd?: boolean;
  zstdLevel?: number;
  debug?: boolean;
};

export const isCompressibleType = (contentType: string | undefined | null): boolean => {
  if (!contentType) return true;
  return DEFAULT_COMPRESSIBLE_TYPE.test(contentType);
};

export type CompressBodyResult = {
  body: Buffer;
  encoding: ContentEncoding;
  profile?: string;
  fallbackFrom?: string;
};

/**
 * Compress a full response body for the chosen encoding.
 */
export const compressBody = async (
  body: Buffer,
  acceptEncoding: string | string[] | undefined,
  options: SharedCodecOptions & {
    selectProfile?: (size: number) => string | undefined;
  } = {}
): Promise<CompressBodyResult> => {
  const {
    threshold = 1024,
    fallbackToGzip = true,
    profile = 'serial',
    allowZstd = isZstdAvailable(),
    zstdLevel,
    selectProfile
  } = options;

  if (body.length < threshold) {
    return { body, encoding: 'identity' };
  }

  let encoding = pickEncoding(acceptEncoding, {
    allowZstd: allowZstd && isZstdAvailable()
  });

  if (encoding === 'identity') {
    return { body, encoding: 'identity' };
  }

  if (encoding === 'openzl') {
    const chosen = selectProfile?.(body.length) ?? profile;
    try {
      const out = await compress(body, { profile: chosen });
      return { body: out, encoding: 'openzl', profile: chosen };
    } catch (err) {
      const next = pickEncoding(acceptEncoding, {
        allowOpenZL: false,
        allowZstd: allowZstd && isZstdAvailable()
      });
      if (next === 'zstd' && isZstdAvailable()) {
        const out = await compressZstd(body, zstdLevel);
        return {
          body: out,
          encoding: 'zstd',
          fallbackFrom: err instanceof Error ? err.name : 'Error'
        };
      }
      if (fallbackToGzip && next === 'gzip') {
        const out = await compressGzip(body);
        return {
          body: out,
          encoding: 'gzip',
          fallbackFrom: err instanceof Error ? err.name : 'Error'
        };
      }
      // try gzip even if next was identity when fallbackToGzip and client has gzip
      if (
        fallbackToGzip &&
        pickEncoding(acceptEncoding, { allowOpenZL: false, allowZstd: false }) === 'gzip'
      ) {
        const out = await compressGzip(body);
        return {
          body: out,
          encoding: 'gzip',
          fallbackFrom: err instanceof Error ? err.name : 'Error'
        };
      }
      throw err;
    }
  }

  if (encoding === 'zstd') {
    if (!isZstdAvailable()) {
      encoding = pickEncoding(acceptEncoding, { allowZstd: false });
      if (encoding === 'gzip') {
        return { body: await compressGzip(body), encoding: 'gzip' };
      }
      return { body, encoding: 'identity' };
    }
    return { body: await compressZstd(body, zstdLevel), encoding: 'zstd' };
  }

  // gzip
  return { body: await compressGzip(body), encoding: 'gzip' };
};
