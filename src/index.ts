import type { Request, Response, NextFunction } from 'express';
import { gzip } from 'zlib';
import { promisify } from 'util';
import { compressWithOpenZL } from './compressor.js';
import { OpenZLCLINotFoundError, CompressionError } from './errors.js';
import type { OpenZLMiddlewareOptions, CompressionResult } from './types.js';

const gzipAsync = promisify(gzip);

/**
 * OpenZL Express Middleware
 * Compresses JSON responses using OpenZL with automatic gzip fallback
 * 
 * @param options - Configuration options
 * @returns Express middleware function
 * 
 * @example
 * ```typescript
 * import express from 'express';
 * import { openzlMiddleware } from '@openzl/express';
 * 
 * const app = express();
 * app.use(openzlMiddleware());
 * 
 * app.get('/api/data', (req, res) => {
 *   res.json({ message: 'This will be compressed with OpenZL!' });
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

  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      return next();
    }

    // Store the original res.json method
    const originalJson = res.json.bind(res);

    // Override res.json to intercept JSON responses
    res.json = function (body: any): Response {
      // Serialize the JSON
      const jsonString = JSON.stringify(body);
      const originalBuffer = Buffer.from(jsonString, 'utf-8');
      const originalSize = originalBuffer.length;

      // Check if response is large enough to compress
      if (originalSize < threshold) {
        if (debug) {
          console.log(`[OpenZL] Response too small (${originalSize} bytes), skipping compression`);
        }
        return originalJson(body);
      }

      // Async compression handler
      const handleCompression = async () => {
        let compressionResult: CompressionResult = {
          originalSize,
          compressedSize: originalSize,
          ratio: 100,
          method: 'none'
        };

        try {
          // Try OpenZL compression first
          if (debug) {
            console.log(`[OpenZL] Attempting OpenZL compression for ${originalSize} bytes`);
          }

          const compressedBuffer = await compressWithOpenZL(originalBuffer);
          
          compressionResult = {
            originalSize,
            compressedSize: compressedBuffer.length,
            ratio: (compressedBuffer.length / originalSize) * 100,
            method: 'openzl'
          };

          // Set headers
          res.setHeader('Content-Encoding', 'openzl');
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('X-OpenZL-Ratio', `${compressionResult.ratio.toFixed(2)}%`);
          res.setHeader('X-Original-Size', originalSize.toString());
          res.setHeader('X-Compressed-Size', compressedBuffer.length.toString());

          if (debug) {
            console.log(`[OpenZL] ✅ Compressed ${originalSize} → ${compressedBuffer.length} bytes (${compressionResult.ratio.toFixed(2)}%)`);
          }

          res.end(compressedBuffer);

        } catch (error) {
          const err = error as Error;
          
          // Log the error
          console.error('[OpenZL] Compression failed:', err.message);

          // Call custom error handler if provided
          if (onError) {
            onError(err, req, res);
          }

          // Try gzip fallback if enabled
          if (fallbackToGzip && !res.headersSent) {
            try {
              if (debug) {
                console.log('[OpenZL] Falling back to gzip compression');
              }

              const gzipBuffer = await gzipAsync(originalBuffer);
              
              compressionResult = {
                originalSize,
                compressedSize: gzipBuffer.length,
                ratio: (gzipBuffer.length / originalSize) * 100,
                method: 'gzip'
              };

              res.setHeader('Content-Encoding', 'gzip');
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('X-Compression-Fallback', 'gzip');
              res.setHeader('X-OpenZL-Error', err.name);

              if (debug) {
                console.log(`[OpenZL] ⚠️ Fallback gzip: ${originalSize} → ${gzipBuffer.length} bytes (${compressionResult.ratio.toFixed(2)}%)`);
              }

              res.end(gzipBuffer);

            } catch (gzipError) {
              // If gzip also fails, send uncompressed
              console.error('[OpenZL] Gzip fallback also failed:', gzipError);
              if (!res.headersSent) {
                return originalJson(body);
              }
            }
          } else if (!res.headersSent) {
            // No fallback, send uncompressed
            return originalJson(body);
          }
        }
      };

      // Execute compression asynchronously
      handleCompression().catch((err) => {
        console.error('[OpenZL] Unexpected error in compression handler:', err);
        if (!res.headersSent) {
          return originalJson(body);
        }
      });

      return res;
    };

    next();
  };
};

// Export types and errors for users
export type { OpenZLMiddlewareOptions, CompressionResult } from './types.js';
export { OpenZLCLINotFoundError, CompressionError } from './errors.js';



