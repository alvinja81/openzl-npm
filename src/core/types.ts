/**
 * HTTP content encodings this library can negotiate.
 * - openzl: OpenZL frame (clients must opt in explicitly — never via `*`)
 * - zstd: Zstandard (Node zlib when available; not implied by `*` alone by default)
 * - gzip: standard gzip (`*` counts as gzip)
 * - identity: no compression
 */
export type ContentEncoding = 'openzl' | 'zstd' | 'gzip' | 'identity';

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
}
