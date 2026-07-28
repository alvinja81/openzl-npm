import { gzip, gunzip, createGzip, type Gzip, type ZlibOptions } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Compress bytes with gzip (Node zlib). Framework-free helper for fallbacks.
 */
export const compressGzip = (buffer: Buffer): Promise<Buffer> => gzipAsync(buffer);

/**
 * Decompress gzip bytes.
 */
export const decompressGzip = (buffer: Buffer): Promise<Buffer> => gunzipAsync(buffer);

/**
 * Streaming gzip Transform (for Express write/end / sendFile piping).
 */
export const createGzipStream = (options?: ZlibOptions): Gzip => createGzip(options);
