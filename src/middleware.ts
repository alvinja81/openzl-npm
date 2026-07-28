import type { Request, Response, NextFunction } from 'express';
import type { Gzip } from 'zlib';
import fs from 'fs';
import { finished } from 'stream';
import {
  compress,
  compressGzip,
  createGzipStream,
  pickEncoding,
  type ContentEncoding
} from './core/index.js';
import type { OpenZLMiddlewareOptions } from './types.js';

/** Default compressible Content-Types (compression-package style). */
const DEFAULT_TYPES = /json|text|javascript|xml|svg|wasm|yaml|toml|csv|markdown|html/i;

type WriteEncoding = BufferEncoding | string | undefined;

/**
 * OpenZL Express middleware — coverage closer to the `compression` package.
 *
 * Hooks `res.write` / `res.end` so `res.json`, `res.send`, streaming, and
 * `res.sendFile` (pipe) all go through the same path.
 *
 * - **gzip**: true streaming Transform → better TTFB on large/streamed bodies
 * - **openzl**: full-body buffer then compress (no stream encoder in this package)
 *
 * @example
 * ```ts
 * app.use(openzlMiddleware({ threshold: 1024, profile: 'serial' }));
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
    debug = false,
    filter,
    preferStreamGzip = true
  } = options;

  const log = (message: string) => {
    if (debug) console.log(`[OpenZL] ${message}`);
  };

  const typeFilter =
    filter ??
    ((req: Request, res: Response) => {
      const type = String(res.getHeader('content-type') ?? '');
      if (!type) return true;
      return DEFAULT_TYPES.test(type);
    });

  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      return next();
    }

    res.setHeader('Vary', 'Accept-Encoding');

    const accept = req.headers['accept-encoding'];
    let encoding: ContentEncoding = pickEncoding(accept);
    if (encoding === 'identity') {
      return next();
    }

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    type Mode = 'pending' | 'identity' | 'gzip-stream' | 'buffer';
    let mode: Mode = 'pending';
    let gzipStream: Gzip | null = null;
    let chunks: Buffer[] = [];
    let length = 0;
    let ended = false;
    let flushing = false;

    const toBuffer = (chunk: unknown, enc?: WriteEncoding): Buffer => {
      if (chunk == null || chunk === '') return Buffer.alloc(0);
      if (Buffer.isBuffer(chunk)) return chunk;
      if (chunk instanceof Uint8Array) return Buffer.from(chunk);
      if (typeof chunk === 'string') {
        return Buffer.from(chunk, (enc as BufferEncoding) || 'utf8');
      }
      return Buffer.from(chunk as ArrayBuffer);
    };

    const alreadyEncoded = (): boolean => {
      const ce = res.getHeader('content-encoding');
      return ce != null && String(ce).length > 0 && String(ce) !== 'identity';
    };

    const canCompressNow = (): boolean =>
      !alreadyEncoded() && typeFilter(req, res);

    const startGzipStream = (): void => {
      if (gzipStream) return;
      res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', 'gzip');
      gzipStream = createGzipStream();
      gzipStream.on('data', (c: Buffer) => {
        originalWrite(c);
      });
      gzipStream.on('error', (err: Error) => {
        console.error('[OpenZL] gzip stream error:', err.message);
        if (onError) onError(err, req, res);
      });
      gzipStream.on('end', () => {
        originalEnd();
      });
      log('gzip streaming started');
    };

    const ensureModeForWrite = (): Mode => {
      if (mode !== 'pending') return mode;

      if (!canCompressNow()) {
        mode = 'identity';
        log('skip compress (filter or already encoded)');
        return mode;
      }

      if (encoding === 'gzip') {
        mode = 'gzip-stream';
        startGzipStream();
        return mode;
      }

      // openzl: buffer whole body (no stream encoder)
      mode = 'buffer';
      return mode;
    };

    const flushOpenZLBuffer = async (): Promise<void> => {
      if (flushing || ended) return;
      flushing = true;

      const body =
        chunks.length === 0
          ? Buffer.alloc(0)
          : chunks.length === 1
            ? chunks[0]!
            : Buffer.concat(chunks, length);
      chunks = [];

      if (body.length < threshold) {
        log(`below threshold (${body.length} < ${threshold}), identity`);
        mode = 'identity';
        if (body.length) originalWrite(body);
        originalEnd();
        ended = true;
        return;
      }

      const chosen =
        selectProfile?.(req, undefined, body.length) ?? profile ?? 'serial';

      try {
        log(`openzl buffer compress ${body.length} bytes profile=${chosen}`);
        const out = await compress(body, { profile: chosen });
        if (res.writableEnded || res.headersSent && ended) return;
        res.removeHeader('Content-Length');
        res.setHeader('Content-Encoding', 'openzl');
        res.setHeader('Content-Length', String(out.length));
        res.setHeader('X-OpenZL-Profile', chosen);
        res.setHeader(
          'X-OpenZL-Ratio',
          `${((out.length / body.length) * 100).toFixed(2)}%`
        );
        res.setHeader('X-Original-Size', String(body.length));
        res.setHeader('X-Compressed-Size', String(out.length));
        originalEnd(out);
        ended = true;
      } catch (error) {
        const err = error as Error;
        console.error('[OpenZL] Compression failed:', err.message);
        if (onError) onError(err, req, res);
        if (res.headersSent && ended) return;

        const canGzip =
          fallbackToGzip && pickEncoding(accept, { allowOpenZL: false }) === 'gzip';
        if (canGzip) {
          const gz = await compressGzip(body);
          res.removeHeader('Content-Length');
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Content-Length', String(gz.length));
          res.setHeader('X-Compression-Fallback', 'gzip');
          res.setHeader('X-OpenZL-Error', err.name);
          originalEnd(gz);
          ended = true;
          return;
        }
        originalEnd(body);
        ended = true;
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).write = function (
      chunk: unknown,
      encodingOrCb?: WriteEncoding | ((error?: Error | null) => void),
      cb?: (error?: Error | null) => void
    ): boolean {
      const enc = typeof encodingOrCb === 'function' ? undefined : encodingOrCb;
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      const buf = toBuffer(chunk, enc);

      const m = ensureModeForWrite();

      if (m === 'identity') {
        return originalWrite(chunk as never, enc as never, callback as never);
      }

      if (m === 'gzip-stream' && gzipStream) {
        return gzipStream.write(buf, callback as never);
      }

      // buffer openzl
      if (buf.length) {
        chunks.push(buf);
        length += buf.length;
      }
      if (callback) callback(null);
      return true;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).end = function (
      chunk?: unknown,
      encodingOrCb?: WriteEncoding | (() => void),
      cb?: () => void
    ): Response {
      if (ended) return res;

      const enc = typeof encodingOrCb === 'function' ? undefined : encodingOrCb;
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;

      if (chunk != null && chunk !== '') {
        res.write(chunk as never, enc as never);
      }

      // No write yet — empty body
      if (mode === 'pending') {
        if (length === 0 && chunks.length === 0) {
          mode = 'identity';
          ended = true;
          originalEnd();
          if (callback) callback();
          return res;
        }
        ensureModeForWrite();
      }

      if (mode === 'identity') {
        ended = true;
        originalEnd(undefined as never, undefined as never, callback as never);
        return res;
      }

      if (mode === 'gzip-stream' && gzipStream) {
        gzipStream.end();
        if (callback) {
          finished(gzipStream, () => callback());
        }
        return res;
      }

      // openzl buffer
      void flushOpenZLBuffer()
        .then(() => {
          if (callback) callback();
        })
        .catch((err: Error) => {
          console.error('[OpenZL] flush failed:', err.message);
          if (!ended && !res.writableEnded) {
            try {
              originalEnd();
            } catch {
              // ignore
            }
            ended = true;
          }
          if (callback) callback();
        });

      return res;
    };

    /**
     * sendFile pipes a read stream into res (write/end).
     * - gzip: streaming path via write hooks
     * - openzl + preferStreamGzip: use gzip if client accepts it (TTFB)
     * - openzl only: read file fully and openzl-compress
     */
    const originalSendFile = res.sendFile?.bind(res);
    if (originalSendFile) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res as any).sendFile = function (
        filePath: string,
        optionsOrFn?: unknown,
        fn?: unknown
      ): void {
        const opts =
          typeof optionsOrFn === 'object' && optionsOrFn !== null ? optionsOrFn : {};
        const cb = typeof optionsOrFn === 'function' ? optionsOrFn : fn;

        if (encoding === 'openzl') {
          const gzipOk =
            pickEncoding(accept, { allowOpenZL: false }) === 'gzip';

          if (preferStreamGzip && gzipOk) {
            log('sendFile: preferStreamGzip → gzip stream');
            encoding = 'gzip';
            // fall through to default sendFile → write/end gzip stream
          } else {
            // Buffer whole file for OpenZL
            fs.readFile(filePath, (err, data) => {
              if (err) {
                if (typeof cb === 'function') (cb as (e: Error) => void)(err);
                else next(err as never);
                return;
              }
              if (!res.getHeader('content-type')) {
                res.type(filePath);
              }
              res.end(data);
              if (typeof cb === 'function') (cb as (e?: Error) => void)();
            });
            return;
          }
        }

        return originalSendFile(filePath, opts as never, cb as never);
      };
    }

    next();
  };
};
