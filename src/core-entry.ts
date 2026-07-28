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
  ContentEncoding,
  CompressionResult,
  CompressMetrics,
  OnCompressHook,
  PickEncodingOptions,
  BackendKind,
  CompressOptions,
  DecompressOptions,
  ResolvedProfile,
  OpenZLErrorCode
} from './core/index.js';

export {
  compressBody,
  isCompressibleType,
  DEFAULT_COMPRESSIBLE_TYPE
} from './adapters/shared.js';

export type { SharedCodecOptions, CompressBodyResult } from './adapters/shared.js';
