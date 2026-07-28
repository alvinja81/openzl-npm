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
  PickEncodingOptions
} from './types.js';

export { OpenZLCLINotFoundError, CompressionError } from './errors.js';

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
  getProfilesRoot
} from './engine.js';

export type { BackendKind, CompressOptions, ResolvedProfile } from './engine.js';

export { compressGzip, decompressGzip, createGzipStream } from './gzip.js';

export {
  isZstdAvailable,
  compressZstd,
  decompressZstd,
  createZstdStream
} from './zstd.js';
