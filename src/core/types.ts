/**
 * HTTP content encodings this library can negotiate.
 * - openzl: OpenZL frame (clients must opt in explicitly)
 * - gzip: standard gzip
 * - identity: no compression
 */
export type ContentEncoding = 'openzl' | 'gzip' | 'identity';

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
   * When openzl and gzip have the same q-value, prefer openzl.
   * Default: true.
   */
  preferOpenZL?: boolean;

  /**
   * Allow selecting gzip (including via `*`). Default: true.
   */
  allowGzip?: boolean;

  /**
   * Allow selecting openzl. Default: true.
   * Set false to force gzip/identity only (e.g. CLI unavailable).
   */
  allowOpenZL?: boolean;
}
