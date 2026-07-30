import type { Request, Response, NextFunction } from 'express';
import type { Transform } from 'stream';
import fs from 'fs';
import { finished, Writable } from 'stream';
import {
  compress,
  compressBrotli,
  compressGzip,
  compressZstd,
  createBrotliStream,
  createGzipStream,
  createZstdStream,
  isBrotliAvailable,
  isZstdAvailable,
  pickEncoding,
  type ContentEncoding
} from '../core/index.js';
import type { OpenZLMiddlewareOptions } from '../types.js';
import { appendVary, hasNoTransform } from './shared.js';

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
    onCompress,
    debug = false,
    filter,
    preferStreamGzip = true,
    allowZstd = isZstdAvailable(),
    zstdLevel,
    allowBrotli = isBrotliAvailable(),
    brotliQuality,
    debugHeaders = false
  } = options;

  const reportCompress = (
    encoding: ContentEncoding,
    bytesIn: number,
    bytesOut: number,
    ms: number,
    extra?: { profile?: string; fallbackFrom?: string }
  ): void => {
    if (!onCompress || encoding === 'identity') return;
    try {
      onCompress({
        encoding,
        ratio: bytesIn > 0 ? (bytesOut / bytesIn) * 100 : 100,
        ms,
        bytesIn,
        bytesOut,
        profile: extra?.profile,
        fallbackFrom: extra?.fallbackFrom
      });
    } catch {
      // ignore hook errors
    }
  };

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
      allowBrotli: allowBrotli && isBrotliAvailable(),
      ...extra
    });

  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      return next();
    }

    res.setHeader('Vary', appendVary(res.getHeader('Vary'), 'Accept-Encoding'));

    const accept = req.headers['accept-encoding'];
    let encoding: ContentEncoding = pick(accept);
    if (encoding === 'identity') {
      return next();
    }

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const rawOn = res.on.bind(res);
    const rawOnce = res.once.bind(res);

    /**
     * `X-OpenZL-*` diagnostics are opt-in (`debugHeaders`): they add bytes to
     * every compressed response and disclose the uncompressed body size.
     */
    const setDebugHeader = (name: string, value: string): void => {
      if (debugHeaders) res.setHeader(name, value);
    };

    type Mode = 'pending' | 'identity' | 'collect' | 'stream' | 'buffer';
    let mode: Mode = 'pending';
    let codecStream: Transform | null = null;
    let codecSink: Writable | null = null;
    let chunks: Buffer[] = [];
    let length = 0;
    let streamIn = 0;
    let streamOut = 0;
    let streamStarted = 0;
    let ended = false;
    let flushing = false;
    let failed = false;
    let aborted = false;

    /**
     * While the codec owns the write path, `res.write` returns the codec's
     * backpressure signal — so `drain` must come from the codec too, or a
     * paused producer would wait on a socket event that never fires.
     * Listeners registered before the codec exists are queued here.
     */
    type DrainListener = { once: boolean; listener: (...args: never[]) => void };
    let pendingDrain: DrainListener[] = [];

    const adoptDrainListeners = (): void => {
      const queued = pendingDrain;
      pendingDrain = [];
      for (const { once, listener } of queued) {
        if (codecStream) {
          if (once) codecStream.once('drain', listener);
          else codecStream.on('drain', listener);
        } else if (once) {
          rawOnce('drain', listener);
        } else {
          rawOn('drain', listener);
        }
      }
    };

    // A client hanging up mid-response is ordinary traffic, not a server fault:
    // stop compressing and keep the resulting write-after-destroy quiet.
    rawOnce('close', () => {
      if (res.writableEnded) return;
      aborted = true;
      codecStream?.destroy();
    });

    /** A codec failure must never leave the client waiting forever. */
    const teardown = (err: Error): void => {
      if (res.writableEnded || res.destroyed) return;
      ended = true;
      if (res.headersSent) {
        // Part of an encoded body is already on the wire; ending quietly would
        // hand the client a truncated frame, so cut the connection instead.
        res.destroy(err);
        return;
      }
      res.removeHeader('Content-Encoding');
      res.removeHeader('Content-Length');
      res.statusCode = 500;
      try {
        originalEnd();
      } catch {
        res.destroy(err);
      }
    };

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

    /**
     * A 206 body is a byte range of the *identity* representation, and its
     * `Content-Range` counts those bytes — re-encoding would make the range
     * describe something the client never asked for. 204/205/304 carry no body.
     */
    const isPartialOrBodiless = (): boolean =>
      res.statusCode === 206 ||
      res.getHeader('content-range') != null ||
      res.statusCode === 204 ||
      res.statusCode === 205 ||
      res.statusCode === 304;

    const canCompressNow = (): boolean =>
      !alreadyEncoded() &&
      !hasNoTransform(res.getHeader('cache-control')) &&
      !isPartialOrBodiless() &&
      typeFilter(req, res);

    const startStream = (which: 'gzip' | 'zstd' | 'br'): void => {
      if (codecStream) return;
      res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', which);
      let stream: Transform;
      try {
        stream =
          which === 'zstd'
            ? createZstdStream(zstdLevel)
            : which === 'br'
              ? createBrotliStream(brotliQuality)
              : createGzipStream();
      } catch {
        log(`${which} stream unavailable, will buffer if needed`);
        mode = 'buffer';
        encoding = which;
        return;
      }
      codecStream = stream;
      streamIn = 0;
      streamOut = 0;
      streamStarted = performance.now();

      /**
       * Codec output → socket. Draining through a Writable (rather than a
       * 'data' listener that pauses on `write() === false`) hands the
       * backpressure handshake to Node: each chunk's write callback fires once
       * the socket has flushed it, so the resume signal is tied to the chunk
       * and cannot be lost the way a shared 'drain' event can. Without this a
       * slow client would make us buffer the whole response in memory.
       */
      const sink = new Writable({
        write(chunk: Buffer, _enc, cb) {
          streamOut += chunk.length;
          originalWrite(chunk, cb as never);
        }
      });
      codecSink = sink;

      const onStreamError = (err: Error): void => {
        if (failed) return;
        failed = true;
        if (aborted) return;
        console.error(`[OpenZL] ${which} stream error:`, err.message);
        if (onError) onError(err, req, res);
        teardown(err);
      };

      sink.on('finish', () => {
        if (failed) return;
        reportCompress(which, streamIn, streamOut, performance.now() - streamStarted);
        originalEnd();
      });
      stream.on('error', onStreamError);
      sink.on('error', onStreamError);
      stream.pipe(sink);
      adoptDrainListeners();
      log(`${which} streaming started`);
    };

    const ensureModeForWrite = (): Mode => {
      if (mode !== 'pending') return mode;

      if (!canCompressNow()) {
        mode = 'identity';
        adoptDrainListeners();
        log('skip compress (filter, no-transform, or already encoded)');
        return mode;
      }

      const declaredLength = Number(res.getHeader('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength < threshold) {
        mode = 'identity';
        adoptDrainListeners();
        log(`below threshold (content-length ${declaredLength} < ${threshold}), identity`);
        return mode;
      }

      if (encoding === 'gzip' || encoding === 'zstd' || encoding === 'br') {
        // Buffer until threshold, then switch to streaming (see write hook)
        mode = 'collect';
        return mode;
      }

      // openzl: buffer whole body
      mode = 'buffer';
      return mode;
    };

    /**
     * A HEAD response carries no body, so nothing here ever compresses one —
     * but its headers are supposed to match what GET would return, and clients
     * do probe with HEAD to learn the encoding.
     *
     * Only claim an encoding when it is knowable: the app must have declared a
     * `Content-Length` at or above the threshold, since otherwise GET might
     * have fallen through to identity. The declared length describes the
     * uncompressed body, so it is dropped rather than left to contradict the
     * `Content-Encoding` we just advertised.
     */
    const applyHeadEncodingHeaders = (): void => {
      if (req.method !== 'HEAD' || res.headersSent) return;
      if (encoding === 'identity' || !canCompressNow()) return;
      const declared = Number(res.getHeader('content-length'));
      if (!Number.isFinite(declared) || declared < threshold) return;
      res.setHeader('Content-Encoding', encoding);
      res.removeHeader('Content-Length');
      log(`HEAD: advertising ${encoding} to match GET`);
    };

    const collectToStream = (): void => {
      mode = 'stream';
      startStream(encoding === 'zstd' ? 'zstd' : encoding === 'br' ? 'br' : 'gzip');
      if (!codecStream) return; // startStream fell back to buffer mode
      const pending = chunks;
      chunks = [];
      length = 0;
      for (const c of pending) {
        streamIn += c.length;
        codecStream.write(c);
      }
    };

    /**
     * OpenZL encode failed — renegotiate among the remaining codecs
     * (zstd > br > gzip) and send the body with whichever the client accepts.
     */
    const fallbackAfterOpenZL = async (
      body: Buffer,
      err: Error,
      started: number
    ): Promise<void> => {
      const sendAs = (enc: 'zstd' | 'br' | 'gzip', out: Buffer): void => {
        res.removeHeader('Content-Length');
        res.setHeader('Content-Encoding', enc);
        res.setHeader('Content-Length', String(out.length));
        setDebugHeader('X-Compression-Fallback', enc);
        setDebugHeader('X-OpenZL-Error', err.name);
        reportCompress(enc, body.length, out.length, performance.now() - started, {
          fallbackFrom: err.name
        });
        originalEnd(out);
        ended = true;
      };

      if (fallbackToGzip) {
        const nextEnc = pick(accept, { allowOpenZL: false });
        if (nextEnc === 'zstd' && isZstdAvailable()) {
          return sendAs('zstd', await compressZstd(body, zstdLevel));
        }
        if (nextEnc === 'br' && isBrotliAvailable()) {
          return sendAs('br', await compressBrotli(body, brotliQuality));
        }
        if (nextEnc === 'gzip') {
          return sendAs('gzip', await compressGzip(body));
        }
      }

      // Fallback disabled, or the client accepts nothing else usable.
      originalEnd(body);
      ended = true;
    };

    const flushBuffer = async (): Promise<void> => {
      if (flushing || ended || failed || aborted) return;
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
        adoptDrainListeners();
        if (body.length) originalWrite(body);
        originalEnd();
        ended = true;
        return;
      }

      if (encoding === 'openzl') {
        const chosen =
          selectProfile?.(req, undefined, body.length) ?? profile ?? 'serial';
        const started = performance.now();
        try {
          log(`openzl buffer compress ${body.length} bytes profile=${chosen}`);
          const out = await compress(body, { profile: chosen });
          if (res.writableEnded || (res.headersSent && ended)) return;
          res.removeHeader('Content-Length');
          res.setHeader('Content-Encoding', 'openzl');
          res.setHeader('Content-Length', String(out.length));
          setDebugHeader('X-OpenZL-Profile', chosen);
          setDebugHeader(
            'X-OpenZL-Ratio',
            `${((out.length / body.length) * 100).toFixed(2)}%`
          );
          setDebugHeader('X-Original-Size', String(body.length));
          setDebugHeader('X-Compressed-Size', String(out.length));
          reportCompress('openzl', body.length, out.length, performance.now() - started, {
            profile: chosen
          });
          originalEnd(out);
          ended = true;
        } catch (error) {
          const err = error as Error;
          console.error('[OpenZL] Compression failed:', err.message);
          if (onError) onError(err, req, res);
          if (res.headersSent && ended) return;
          await fallbackAfterOpenZL(body, err, started);
        }
        return;
      }

      // zstd/br/gzip buffer path (below-threshold collect, or stream failed to start)
      const bufStarted = performance.now();
      if (encoding === 'zstd' && isZstdAvailable()) {
        const out = await compressZstd(body, zstdLevel);
        res.removeHeader('Content-Length');
        res.setHeader('Content-Encoding', 'zstd');
        res.setHeader('Content-Length', String(out.length));
        reportCompress('zstd', body.length, out.length, performance.now() - bufStarted);
        originalEnd(out);
        ended = true;
        return;
      }

      if (encoding === 'br' && isBrotliAvailable()) {
        const out = await compressBrotli(body, brotliQuality);
        res.removeHeader('Content-Length');
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Content-Length', String(out.length));
        reportCompress('br', body.length, out.length, performance.now() - bufStarted);
        originalEnd(out);
        ended = true;
        return;
      }

      const gz = await compressGzip(body);
      res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(gz.length));
      reportCompress('gzip', body.length, gz.length, performance.now() - bufStarted);
      originalEnd(gz);
      ended = true;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).write = function (
      chunk: unknown,
      encodingOrCb?: WriteEncoding | ((error?: Error | null) => void),
      cb?: (error?: Error | null) => void
    ): boolean {
      if (ended || failed || aborted) return false;

      const enc = typeof encodingOrCb === 'function' ? undefined : encodingOrCb;
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      const buf = toBuffer(chunk, enc);

      const m = ensureModeForWrite();

      if (m === 'identity') {
        return originalWrite(chunk as never, enc as never, callback as never);
      }

      if (m === 'collect') {
        if (buf.length) {
          chunks.push(buf);
          length += buf.length;
        }
        if (length >= threshold) collectToStream();
        if (callback) callback(null);
        return true;
      }

      if (m === 'stream' && codecStream) {
        streamIn += buf.length;
        return codecStream.write(buf, callback as never);
      }

      if (buf.length) {
        chunks.push(buf);
        length += buf.length;
      }
      if (callback) callback(null);
      return true;
    };

    // Route 'drain' to whichever writable currently applies backpressure.
    // Everything else (close, finish, error, …) goes to the response untouched.
    const hookDrain = (
      once: boolean,
      original: (type: string, listener: (...args: never[]) => void) => Response
    ) =>
      function (type: string, listener: (...args: never[]) => void): Response {
        if (type !== 'drain') return original(type, listener);
        if (codecStream) {
          if (once) codecStream.once('drain', listener);
          else codecStream.on('drain', listener);
          return res;
        }
        if (mode === 'identity') return original(type, listener);
        pendingDrain.push({ once, listener });
        return res;
      };

    /* eslint-disable @typescript-eslint/no-explicit-any */
    (res as any).on = hookDrain(false, rawOn as any);
    (res as any).addListener = hookDrain(false, rawOn as any);
    (res as any).once = hookDrain(true, rawOnce as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */

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
          applyHeadEncodingHeaders();
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
        ended = true;
        codecStream.end();
        if (callback) {
          // Report completion once the bytes reach the socket, not merely the codec
          finished(codecSink ?? codecStream, () => callback());
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

        // A range request must keep Express's 206 handling: the openzl path
        // below reads the whole file and would answer a partial request with
        // the entire, re-encoded representation.
        if (encoding === 'openzl' && !req.headers.range) {
          const streamAlt = pick(accept, { allowOpenZL: false });
          if (
            preferStreamGzip &&
            (streamAlt === 'gzip' || streamAlt === 'zstd' || streamAlt === 'br')
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
