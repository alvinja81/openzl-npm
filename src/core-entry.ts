/**
 * Framework-free core entry (`import … from 'openzl-express/core'`).
 * No Express or Fastify types/deps.
 */

export {
  compress,
  decompress,
  compressWithOpenZL,
  decompressWithOpenZL,
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
  OpenZLCLINotFoundError,
  CompressionError
} from './core/index.js';

export type {
  ContentEncoding,
  CompressionResult,
  PickEncodingOptions,
  BackendKind,
  CompressOptions,
  ResolvedProfile
} from './core/index.js';

export {
  compressBody,
  isCompressibleType,
  DEFAULT_COMPRESSIBLE_TYPE
} from './adapters/shared.js';

export type { SharedCodecOptions, CompressBodyResult } from './adapters/shared.js';
