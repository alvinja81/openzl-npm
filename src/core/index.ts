/**
 * Framework-free OpenZL / multi-codec core.
 *
 * Wire contract:
 * - Client:  Accept-Encoding: openzl (opt-in), zstd, gzip
 * - Server:  Content-Encoding: openzl | zstd | gzip  +  Vary: Accept-Encoding
 * - openzl never selected via `*`
 */

export type {
  ContentEncoding,
  CompressionResult,
  CompressMetrics,
  OnCompressHook,
  PickEncodingOptions
} from './types.js';

export {
  OpenZLError,
  OpenZLCLINotFoundError,
  CompressionError,
  DecompressionError,
  LimitError,
  isOpenZLError
} from './errors.js';
export type { OpenZLErrorCode } from './errors.js';

export { parseAcceptEncoding, pickEncoding } from './negotiate.js';

export {
  compress,
  decompress,
  compressWithOpenZL,
  decompressWithOpenZL,
  checkCLIAvailable,
  resetCLICache,
  shutdownOpenZL,
  getActiveBackend,
  isNativeAvailable,
  getNativeLoadError,
  listProfiles,
  resolveProfile,
  suggestProfile,
  getProfilesRoot,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS
} from './engine.js';

export type {
  BackendKind,
  CompressOptions,
  DecompressOptions,
  ResolvedProfile
} from './engine.js';

export { compressGzip, decompressGzip, createGzipStream } from './gzip.js';

export {
  isZstdAvailable,
  compressZstd,
  decompressZstd,
  createZstdStream
} from './zstd.js';
