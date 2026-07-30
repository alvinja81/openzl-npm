/**
 * Shared adapter helpers (framework-free compression of a finished body).
 */

import {
  compress,
  compressGzip,
  compressZstd,
  isZstdAvailable,
  pickEncoding,
  type ContentEncoding,
  type CompressMetrics,
  type OnCompressHook
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
  /** Observability: called after a successful (or fallback) compress. */
  onCompress?: OnCompressHook;
};

export const isCompressibleType = (contentType: string | undefined | null): boolean => {
  if (!contentType) return true;
  return DEFAULT_COMPRESSIBLE_TYPE.test(contentType);
};

/** RFC 9110 §7.7: `Cache-Control: no-transform` forbids changing Content-Encoding. */
const NO_TRANSFORM = /(?:^|,)\s*no-transform\s*(?:,|$)/i;

export const hasNoTransform = (
  cacheControl: string | number | string[] | undefined | null
): boolean => {
  if (cacheControl == null) return false;
  const value = Array.isArray(cacheControl)
    ? cacheControl.join(',')
    : String(cacheControl);
  return NO_TRANSFORM.test(value);
};

/**
 * Append a field to an existing Vary header value without clobbering it
 * (`Vary: Origin` from cors must survive). `*` swallows everything.
 */
export const appendVary = (
  existing: string | number | string[] | undefined | null,
  field: string
): string => {
  if (existing == null || existing === '') return field;
  const current = Array.isArray(existing) ? existing.join(', ') : String(existing);
  const fields = current.split(',').map((f) => f.trim()).filter(Boolean);
  if (fields.includes('*')) return '*';
  if (fields.some((f) => f.toLowerCase() === field.toLowerCase())) return current;
  return `${current}, ${field}`;
};

export type CompressBodyResult = {
  body: Buffer;
  encoding: ContentEncoding;
  profile?: string;
  fallbackFrom?: string;
  /** Wall time of the compress path (ms). */
  ms?: number;
};

const emitMetrics = (
  onCompress: OnCompressHook | undefined,
  bytesIn: number,
  result: CompressBodyResult,
  started: number
): void => {
  if (!onCompress || result.encoding === 'identity') return;
  const ms = result.ms ?? performance.now() - started;
  const metrics: CompressMetrics = {
    encoding: result.encoding,
    ratio: bytesIn > 0 ? (result.body.length / bytesIn) * 100 : 100,
    ms,
    bytesIn,
    bytesOut: result.body.length,
    profile: result.profile,
    fallbackFrom: result.fallbackFrom
  };
  try {
    onCompress(metrics);
  } catch {
    // never let metrics hooks break the response path
  }
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
    selectProfile,
    onCompress
  } = options;

  const started = performance.now();

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
      const result: CompressBodyResult = {
        body: out,
        encoding: 'openzl',
        profile: chosen,
        ms: performance.now() - started
      };
      emitMetrics(onCompress, body.length, result, started);
      return result;
    } catch (err) {
      const next = pickEncoding(acceptEncoding, {
        allowOpenZL: false,
        allowZstd: allowZstd && isZstdAvailable()
      });
      if (next === 'zstd' && isZstdAvailable()) {
        const out = await compressZstd(body, zstdLevel);
        const result: CompressBodyResult = {
          body: out,
          encoding: 'zstd',
          fallbackFrom: err instanceof Error ? err.name : 'Error',
          ms: performance.now() - started
        };
        emitMetrics(onCompress, body.length, result, started);
        return result;
      }
      if (fallbackToGzip && next === 'gzip') {
        const out = await compressGzip(body);
        const result: CompressBodyResult = {
          body: out,
          encoding: 'gzip',
          fallbackFrom: err instanceof Error ? err.name : 'Error',
          ms: performance.now() - started
        };
        emitMetrics(onCompress, body.length, result, started);
        return result;
      }
      // try gzip even if next was identity when fallbackToGzip and client has gzip
      if (
        fallbackToGzip &&
        pickEncoding(acceptEncoding, { allowOpenZL: false, allowZstd: false }) === 'gzip'
      ) {
        const out = await compressGzip(body);
        const result: CompressBodyResult = {
          body: out,
          encoding: 'gzip',
          fallbackFrom: err instanceof Error ? err.name : 'Error',
          ms: performance.now() - started
        };
        emitMetrics(onCompress, body.length, result, started);
        return result;
      }
      throw err;
    }
  }

  if (encoding === 'zstd') {
    if (!isZstdAvailable()) {
      encoding = pickEncoding(acceptEncoding, { allowZstd: false });
      if (encoding === 'gzip') {
        const out = await compressGzip(body);
        const result: CompressBodyResult = {
          body: out,
          encoding: 'gzip',
          ms: performance.now() - started
        };
        emitMetrics(onCompress, body.length, result, started);
        return result;
      }
      return { body, encoding: 'identity' };
    }
    const out = await compressZstd(body, zstdLevel);
    const result: CompressBodyResult = {
      body: out,
      encoding: 'zstd',
      ms: performance.now() - started
    };
    emitMetrics(onCompress, body.length, result, started);
    return result;
  }

  // gzip
  const out = await compressGzip(body);
  const result: CompressBodyResult = {
    body: out,
    encoding: 'gzip',
    ms: performance.now() - started
  };
  emitMetrics(onCompress, body.length, result, started);
  return result;
};
