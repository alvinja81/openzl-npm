import type { Request, Response, NextFunction } from 'express';
import {
  compress,
  compressGzip,
  pickEncoding,
  type CompressionResult
} from './core/index.js';
import type { OpenZLMiddlewareOptions } from './types.js';

/**
 * OpenZL Express middleware — thin adapter over the core package APIs.
 *
 * Content negotiation (via {@link pickEncoding}):
 * - `Accept-Encoding: openzl` → OpenZL
 * - `Accept-Encoding: gzip` (or `*`) → gzip
 * - neither → uncompressed JSON
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { openzlMiddleware } from 'openzl-express';
 *
 * const app = express();
 * app.use(openzlMiddleware());
 * ```
 */
export const openzlMiddleware = (options: OpenZLMiddlewareOptions = {}) => {
  const {
    enabled = true,
    threshold = 1024,
    fallbackToGzip = true,
    profile = 'serial',
    selectProfile,
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

    res.json = function (body: unknown): Response {
      if (res.headersSent) {
        return originalJson(body);
      }

      const jsonString = JSON.stringify(body);
      const originalBuffer = Buffer.from(jsonString, 'utf-8');
      const originalSize = originalBuffer.length;

      res.setHeader('Vary', 'Accept-Encoding');

      if (originalSize < threshold) {
        log(`Response too small (${originalSize} bytes), skipping compression`);
        return originalJson(body);
      }

      const encoding = pickEncoding(req.headers['accept-encoding']);

      if (encoding === 'identity') {
        log('Client accepts neither openzl nor gzip, sending uncompressed');
        return originalJson(body);
      }

      const sendGzip = async (openzlError?: Error) => {
        const gzipBuffer = await compressGzip(originalBuffer);
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
        if (encoding === 'openzl') {
          try {
            const chosen =
              selectProfile?.(req, body, originalSize) ?? profile ?? 'serial';
            log(
              `Attempting OpenZL compression for ${originalSize} bytes (profile=${chosen})`
            );
            const compressedBuffer = await compress(originalBuffer, {
              profile: chosen
            });
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
            res.setHeader('X-OpenZL-Profile', chosen);
            res.setHeader('X-Original-Size', originalSize.toString());
            res.setHeader('X-Compressed-Size', compressedBuffer.length.toString());

            log(
              `OpenZL[${chosen}]: ${originalSize} → ${compressedBuffer.length} bytes (${result.ratio.toFixed(2)}%)`
            );
            res.end(compressedBuffer);
            return;
          } catch (error) {
            const err = error as Error;
            console.error('[OpenZL] Compression failed:', err.message);
            if (onError) {
              onError(err, req, res);
            }
            if (res.headersSent) return;

            const canGzip =
              fallbackToGzip &&
              pickEncoding(req.headers['accept-encoding'], { allowOpenZL: false }) ===
                'gzip';

            if (canGzip) {
              await sendGzip(err);
              return;
            }
            originalJson(body);
            return;
          }
        }

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
