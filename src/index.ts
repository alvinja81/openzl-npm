/**
 * openzl-express public API (root entry — back-compat).
 *
 * Prefer subpath imports for new code:
 * - `openzl-express/core`     — framework-free
 * - `openzl-express/express`  — Express middleware
 * - `openzl-express/fastify`  — Fastify plugin
 */

export { openzlMiddleware } from './adapters/express.js';

export type {
  OpenZLMiddlewareOptions,
  ExpressMiddleware,
  CompressionResult,
  CompressMetrics,
  OnCompressHook,
  ContentEncoding,
  PickEncodingOptions
} from './types.js';

export {
  compress,
  decompress,
  compressGzip,
  decompressGzip,
  createGzipStream,
  isZstdAvailable,
  compressZstd,
  decompressZstd,
  createZstdStream,
  pickEncoding,
  parseAcceptEncoding,
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
  OpenZLError,
  OpenZLCLINotFoundError,
  CompressionError,
  DecompressionError,
  LimitError,
  isOpenZLError,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS
} from './core/index.js';

export type {
  BackendKind,
  CompressOptions,
  DecompressOptions,
  ResolvedProfile,
  OpenZLErrorCode
} from './core/index.js';

export {
  compressWithOpenZL,
  decompressWithOpenZL
} from './core/index.js';

export { openzlFastify } from './adapters/fastify.js';
export type { OpenZLFastifyOptions } from './adapters/fastify.js';

export {
  compressBody,
  isCompressibleType
} from './adapters/shared.js';
