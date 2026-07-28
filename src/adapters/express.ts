import type { Request, Response, NextFunction } from 'express';
import type { Transform } from 'stream';
import fs from 'fs';
import { finished } from 'stream';
import {
  compress,
  compressGzip,
  compressZstd,
  createGzipStream,
  createZstdStream,
  isZstdAvailable,
  pickEncoding,
  type ContentEncoding
} from '../core/index.js';
import type { OpenZLMiddlewareOptions } from '../types.js';

/** Default compressible Content-Types (compression-package style). */
const DEFAULT_TYPES = /json|text|javascript|xml|svg|wasm|yaml|toml|csv|markdown|html/i;

type WriteEncoding = BufferEncoding | string | undefined;

/**
 * Multi-codec Express middleware: openzl (opt-in) · zstd · gzip.
 *
 * Hooks `res.write` / `res.end` so `res.json`, `res.send`, streams, and
 * `res.sendFile` share one path.
 *
 * - **gzip / zstd**: streaming Transform when available → better TTFB
 * - **openzl**: full-body buffer then compress
 *
 * Heroes: gzip and zstd are always preferred for general traffic.
 * OpenZL only when the client lists it explicitly.
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
    preferStreamGzip = true,
    allowZstd = isZstdAvailable(),
    zstdLevel
  } = options;

  const log = (message: string) => {
    if (debug) console.log(`[OpenZL] ${message}`);
  };

  const typeFilter =
    filter ??
    ((_req: Request, res: Response) => {
      const type = String(res.getHeader('content-type') ?? '');
      if (!type) return true;
      return DEFAULT_TYPES.test(type);
    });

  const pick = (accept: string | string[] | undefined, extra = {}) =>
    pickEncoding(accept, {
      allowZstd: allowZstd && isZstdAvailable(),
      ...extra
    });

  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      return next();
    }

    res.setHeader('Vary', 'Accept-Encoding');

    const accept = req.headers['accept-encoding'];
    let encoding: ContentEncoding = pick(accept);
    if (encoding === 'identity') {
      return next();
    }

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    type Mode = 'pending' | 'identity' | 'stream' | 'buffer';
    let mode: Mode = 'pending';
    let codecStream: Transform | null = null;
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

    const startStream = (which: 'gzip' | 'zstd'): void => {
      if (codecStream) return;
      res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', which);
      let stream: Transform;
      try {
        stream =
          which === 'zstd' ? createZstdStream(zstdLevel) : createGzipStream();
      } catch {
        log(`${which} stream unavailable, will buffer if needed`);
        mode = 'buffer';
        encoding = which;
        return;
      }
      codecStream = stream;
      stream.on('data', (c: Buffer) => {
        originalWrite(c);
      });
      stream.on('error', (err: Error) => {
        console.error(`[OpenZL] ${which} stream error:`, err.message);
        if (onError) onError(err, req, res);
      });
      stream.on('end', () => {
        originalEnd();
      });
      log(`${which} streaming started`);
    };

    const ensureModeForWrite = (): Mode => {
      if (mode !== 'pending') return mode;

      if (!canCompressNow()) {
        mode = 'identity';
        log('skip compress (filter or already encoded)');
        return mode;
      }

      if (encoding === 'gzip') {
        mode = 'stream';
        startStream('gzip');
        return mode;
      }

      if (encoding === 'zstd') {
        mode = 'stream';
        startStream('zstd');
        // startStream may fall back to buffer
        return mode;
      }

      // openzl: buffer whole body
      mode = 'buffer';
      return mode;
    };

    const fallbackAfterOpenZL = async (body: Buffer, err: Error): Promise<void> => {
      // Prefer zstd then gzip when renegotiating without openzl
      const nextEnc = pick(accept, { allowOpenZL: false });
      if (nextEnc === 'zstd' && isZstdAvailable()) {
        const out = await compressZstd(body, zstdLevel);
        res.removeHeader('Content-Length');
        res.setHeader('Content-Encoding', 'zstd');
        res.setHeader('Content-Length', String(out.length));
        res.setHeader('X-Compression-Fallback', 'zstd');
        res.setHeader('X-OpenZL-Error', err.name);
        originalEnd(out);
        ended = true;
        return;
      }
      if (fallbackToGzip && (nextEnc === 'gzip' || nextEnc === 'identity')) {
        // if identity only but fallbackToGzip, still try gzip when client accepts it
      }
      const canGzip =
        fallbackToGzip && pick(accept, { allowOpenZL: false, allowZstd: false }) === 'gzip';
      if (canGzip || (fallbackToGzip && pick(accept, { allowOpenZL: false }) === 'gzip')) {
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
      if (fallbackToGzip && pick(accept, { allowOpenZL: false }) === 'zstd' && isZstdAvailable()) {
        const out = await compressZstd(body, zstdLevel);
        res.removeHeader('Content-Length');
        res.setHeader('Content-Encoding', 'zstd');
        res.setHeader('Content-Length', String(out.length));
        res.setHeader('X-Compression-Fallback', 'zstd');
        res.setHeader('X-OpenZL-Error', err.name);
        originalEnd(out);
        ended = true;
        return;
      }
      originalEnd(body);
      ended = true;
    };

    const flushBuffer = async (): Promise<void> => {
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

      if (encoding === 'openzl') {
        const chosen =
          selectProfile?.(req, undefined, body.length) ?? profile ?? 'serial';
        try {
          log(`openzl buffer compress ${body.length} bytes profile=${chosen}`);
          const out = await compress(body, { profile: chosen });
          if (res.writableEnded || (res.headersSent && ended)) return;
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
          await fallbackAfterOpenZL(body, err);
        }
        return;
      }

      // zstd/gzip buffer fallback (stream failed to start)
      if (encoding === 'zstd' && isZstdAvailable()) {
        const out = await compressZstd(body, zstdLevel);
        res.removeHeader('Content-Length');
        res.setHeader('Content-Encoding', 'zstd');
        res.setHeader('Content-Length', String(out.length));
        originalEnd(out);
        ended = true;
        return;
      }

      const gz = await compressGzip(body);
      res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(gz.length));
      originalEnd(gz);
      ended = true;
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

      if (m === 'stream' && codecStream) {
        return codecStream.write(buf, callback as never);
      }

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

      if (mode === 'stream' && codecStream) {
        codecStream.end();
        if (callback) {
          finished(codecStream, () => callback());
        }
        return res;
      }

      void flushBuffer()
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
          const streamAlt = pick(accept, { allowOpenZL: false });
          if (
            preferStreamGzip &&
            (streamAlt === 'gzip' || streamAlt === 'zstd')
          ) {
            log(`sendFile: preferStream → ${streamAlt} instead of openzl buffer`);
            encoding = streamAlt;
          } else {
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
