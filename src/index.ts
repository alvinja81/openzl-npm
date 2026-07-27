/**
 * openzl-express public API
 *
 * Core (framework-free) lives in `./core` and is re-exported here.
 * Express middleware is a thin adapter on top of core.
 */

export { openzlMiddleware } from './middleware.js';

export type {
  OpenZLMiddlewareOptions,
  ExpressMiddleware,
  CompressionResult,
  ContentEncoding,
  PickEncodingOptions
} from './types.js';

// Core API — preferred names for new code
export {
  compress,
  decompress,
  compressGzip,
  decompressGzip,
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
  OpenZLCLINotFoundError,
  CompressionError
} from './core/index.js';

export type { BackendKind, CompressOptions, ResolvedProfile } from './core/index.js';

// Backward-compatible aliases
export {
  compressWithOpenZL,
  decompressWithOpenZL
} from './core/index.js';
