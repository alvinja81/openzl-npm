/**
 * HTTP content encodings this library can negotiate.
 * - openzl: OpenZL frame (clients must opt in explicitly — never via `*`)
 * - zstd: Zstandard (Node zlib when available; not implied by `*` alone by default)
 * - br: Brotli (Node zlib; not implied by `*` alone by default)
 * - gzip: standard gzip (`*` counts as gzip)
 * - identity: no compression
 */
export type ContentEncoding = 'openzl' | 'zstd' | 'br' | 'gzip' | 'identity';

/**
 * Result metadata from a compress operation.
 */
export interface CompressionResult {
  originalSize: number;
  compressedSize: number;
  /** Compressed size as a percentage of original (lower is better). */
  ratio: number;
  method: ContentEncoding;
}

/**
 * Observability payload for middleware / adapter compress hooks.
 * `ratio` is compressed/original as a percentage (same units as `X-OpenZL-Ratio`).
 */
export interface CompressMetrics {
  encoding: ContentEncoding;
  /** Compressed size as a percentage of original (lower is better). */
  ratio: number;
  /** Wall time of the compress call (ms). */
  ms: number;
  bytesIn: number;
  bytesOut: number;
  /** OpenZL profile used (when encoding is openzl). */
  profile?: string;
  /** Present when openzl failed and another codec was used. */
  fallbackFrom?: string;
}

export type OnCompressHook = (metrics: CompressMetrics) => void;

/**
 * Options for {@link pickEncoding}.
 */
export interface PickEncodingOptions {
  /**
   * When openzl ties with others on q-value, prefer openzl.
   * Default: true.
   */
  preferOpenZL?: boolean;

  /**
   * When zstd ties with gzip on q-value, prefer zstd.
   * Default: true (zstd is usually the better modern default).
   */
  preferZstd?: boolean;

  /**
   * When brotli ties on q-value, prefer it over gzip (but below zstd).
   * Default: true.
   */
  preferBrotli?: boolean;

  /**
   * Allow selecting brotli when the client lists `br`.
   * Default: true when the runtime has brotli; callers may force false.
   */
  allowBrotli?: boolean;

  /**
   * Allow selecting gzip (including via `*`). Default: true.
   */
  allowGzip?: boolean;

  /**
   * Allow selecting zstd when the client lists it (or via `*` if starMeansZstd).
   * Default: true when runtime has zstd; callers may force false.
   */
  allowZstd?: boolean;

  /**
   * Allow selecting openzl. Default: true.
   * Set false to force zstd/gzip/identity only.
   */
  allowOpenZL?: boolean;

  /**
   * If true, `Accept-Encoding: *` also counts as zstd support.
   * Default: false — safer; many clients send `*` meaning “anything common” (gzip).
   * OpenZL is never selected via `*`.
   */
  starMeansZstd?: boolean;

  /**
   * If true, `Accept-Encoding: *` also counts as brotli support.
   * Default: false, for the same reason as {@link starMeansZstd}.
   */
  starMeansBrotli?: boolean;
}
