import type { Request, Response, NextFunction } from 'express';
import { gzip } from 'zlib';
import { promisify } from 'util';
import { compressWithOpenZL } from './compressor.js';
import type { OpenZLMiddlewareOptions, CompressionResult } from './types.js';

const gzipAsync = promisify(gzip);

/**
 * Parse the Accept-Encoding header into a set of accepted encoding names.
 * Encodings explicitly rejected with q=0 are excluded.
 */
const acceptedEncodings = (req: Request): Set<string> => {
  const header = req.headers['accept-encoding'];
  const value = Array.isArray(header) ? header.join(',') : header ?? '';
  const accepted = new Set<string>();

  for (const part of value.split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const q = params
      .map((p) => p.trim())
      .find((p) => p.startsWith('q='));
    if (q && parseFloat(q.slice(2)) === 0) continue;
    accepted.add(name.trim().toLowerCase());
  }

  return accepted;
};

/**
 * OpenZL Express Middleware
 * Compresses JSON responses using OpenZL for clients that opt in via
 * `Accept-Encoding: openzl`, with standard gzip for everyone else.
 *
 * Content negotiation:
 * - Client sends `Accept-Encoding: openzl` → OpenZL compression
 * - Client sends `Accept-Encoding: gzip` (browsers, curl, axios) → gzip
 * - Neither → uncompressed JSON
 *
 * @param options - Configuration options
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { openzlMiddleware } from 'openzl-express';
 *
 * const app = express();
 * app.use(openzlMiddleware());
 *
 * app.get('/api/data', (req, res) => {
 *   res.json({ message: 'Compressed with OpenZL for opted-in clients!' });
 * });
 * ```
 */
export const openzlMiddleware = (options: OpenZLMiddlewareOptions = {}) => {
  const {
    enabled = true,
    threshold = 1024,
    fallbackToGzip = true,
    onError,
    debug = false
  } = options;

  const log = (message: string) => {
    if (debug) console.log(`[OpenZL] ${message}`);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      return next();
    }

    const originalJson = res.json.bind(res);

    res.json = function (body: any): Response {
      if (res.headersSent) {
        return originalJson(body);
      }

      const jsonString = JSON.stringify(body);
      const originalBuffer = Buffer.from(jsonString, 'utf-8');
      const originalSize = originalBuffer.length;

      // Caches must key on Accept-Encoding once responses vary by it
      res.setHeader('Vary', 'Accept-Encoding');

      if (originalSize < threshold) {
        log(`Response too small (${originalSize} bytes), skipping compression`);
        return originalJson(body);
      }

      const accepted = acceptedEncodings(req);
      const wantsOpenZL = accepted.has('openzl');
      const wantsGzip = accepted.has('gzip') || accepted.has('*');

      if (!wantsOpenZL && !wantsGzip) {
        log('Client accepts neither openzl nor gzip, sending uncompressed');
        return originalJson(body);
      }

      const sendGzip = async (openzlError?: Error) => {
        const gzipBuffer = await gzipAsync(originalBuffer);
        const result: CompressionResult = {
          originalSize,
          compressedSize: gzipBuffer.length,
          ratio: (gzipBuffer.length / originalSize) * 100,
          method: 'gzip'
        };

        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', gzipBuffer.length.toString());
        if (openzlError) {
          res.setHeader('X-Compression-Fallback', 'gzip');
          res.setHeader('X-OpenZL-Error', openzlError.name);
        }

        log(`gzip: ${originalSize} → ${gzipBuffer.length} bytes (${result.ratio.toFixed(2)}%)`);
        res.end(gzipBuffer);
      };

      const handleCompression = async () => {
        // OpenZL path: only for clients that explicitly opted in
        if (wantsOpenZL) {
          try {
            log(`Attempting OpenZL compression for ${originalSize} bytes`);
            const compressedBuffer = await compressWithOpenZL(originalBuffer);
            const result: CompressionResult = {
              originalSize,
              compressedSize: compressedBuffer.length,
              ratio: (compressedBuffer.length / originalSize) * 100,
              method: 'openzl'
            };

            res.setHeader('Content-Encoding', 'openzl');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Length', compressedBuffer.length.toString());
            res.setHeader('X-OpenZL-Ratio', `${result.ratio.toFixed(2)}%`);
            res.setHeader('X-Original-Size', originalSize.toString());
            res.setHeader('X-Compressed-Size', compressedBuffer.length.toString());

            log(`OpenZL: ${originalSize} → ${compressedBuffer.length} bytes (${result.ratio.toFixed(2)}%)`);
            res.end(compressedBuffer);
            return;
          } catch (error) {
            const err = error as Error;
            console.error('[OpenZL] Compression failed:', err.message);
            if (onError) {
              onError(err, req, res);
            }
            if (res.headersSent) return;

            if (fallbackToGzip && wantsGzip) {
              await sendGzip(err);
              return;
            }
            originalJson(body);
            return;
          }
        }

        // Standard clients: plain gzip
        await sendGzip();
      };

      handleCompression().catch((err) => {
        console.error('[OpenZL] Unexpected error in compression handler:', err);
        if (!res.headersSent) {
          originalJson(body);
        }
      });

      return res;
    };

    next();
  };
};

// Export types, errors, and CLI helpers for users
export type { OpenZLMiddlewareOptions, CompressionResult } from './types.js';
export { OpenZLCLINotFoundError, CompressionError } from './errors.js';
export {
  checkCLIAvailable,
  compressWithOpenZL,
  decompressWithOpenZL,
  resetCLICache
} from './compressor.js';
