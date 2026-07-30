/**
 * Shared adapter helpers (framework-free compression of a finished body).
 */

import {
  compress,
  compressBrotli,
  compressGzip,
  compressZstd,
  isBrotliAvailable,
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
  /** Allow brotli when the client sends `br`. Default: true when available. */
  allowBrotli?: boolean;
  /** Brotli quality 0–11. Default 4 (dynamic-response friendly). */
  brotliQuality?: number;
  /**
   * Emit `X-OpenZL-*` / `X-Compression-*` diagnostic headers.
   * Default false — they add bytes to every compressed response and disclose
   * the uncompressed body size.
   */
  debugHeaders?: boolean;
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
    allowBrotli = isBrotliAvailable(),
    brotliQuality,
    selectProfile,
    onCompress
  } = options;

  const started = performance.now();

  if (body.length < threshold) {
    return { body, encoding: 'identity' };
  }

  const negotiate = (extra: Parameters<typeof pickEncoding>[1] = {}): ContentEncoding =>
    pickEncoding(acceptEncoding, {
      allowZstd: allowZstd && isZstdAvailable(),
      allowBrotli: allowBrotli && isBrotliAvailable(),
      ...extra
    });

  /** Encode with one of the plain codecs; undefined when it is not usable here. */
  const runCodec = async (enc: ContentEncoding): Promise<Buffer | undefined> => {
    if (enc === 'zstd' && isZstdAvailable()) return compressZstd(body, zstdLevel);
    if (enc === 'br' && isBrotliAvailable()) return compressBrotli(body, brotliQuality);
    if (enc === 'gzip') return compressGzip(body);
    return undefined;
  };

  const finish = (
    enc: ContentEncoding,
    out: Buffer,
    extra: { profile?: string; fallbackFrom?: string } = {}
  ): CompressBodyResult => {
    const result: CompressBodyResult = {
      body: out,
      encoding: enc,
      ms: performance.now() - started,
      ...extra
    };
    emitMetrics(onCompress, body.length, result, started);
    return result;
  };

  const encoding = negotiate();

  if (encoding === 'identity') {
    return { body, encoding: 'identity' };
  }

  if (encoding === 'openzl') {
    const chosen = selectProfile?.(body.length) ?? profile;
    try {
      const out = await compress(body, { profile: chosen });
      return finish('openzl', out, { profile: chosen });
    } catch (err) {
      if (!fallbackToGzip) throw err;
      const next = negotiate({ allowOpenZL: false });
      const out = await runCodec(next);
      if (!out) throw err;
      return finish(next, out, {
        fallbackFrom: err instanceof Error ? err.name : 'Error'
      });
    }
  }

  const out = await runCodec(encoding);
  if (out) {
    return finish(encoding, out);
  }

  // Negotiated codec is missing at runtime — retry without it.
  const next = negotiate(
    encoding === 'zstd' ? { allowZstd: false } : { allowBrotli: false }
  );
  const alt = await runCodec(next);
  return alt ? finish(next, alt) : { body, encoding: 'identity' };
};
