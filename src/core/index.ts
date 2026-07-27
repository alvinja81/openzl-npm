/**
 * Framework-free OpenZL core.
 *
 * Use this from any Node server/client. Express middleware is a thin adapter
 * on top of these APIs.
 *
 * Wire contract:
 * - Client:  Accept-Encoding: openzl   (and usually gzip as fallback)
 * - Server:  Content-Encoding: openzl | gzip  +  Vary: Accept-Encoding
 * - If OpenZL is unavailable → gzip or identity
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
  resetCLICache
} from './engine.js';

export { compressGzip, decompressGzip } from './gzip.js';
