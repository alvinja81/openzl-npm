/**
 * Fastify plugin — compresses onSend payloads with openzl | zstd | br | gzip.
 *
 * Uses `fastify-plugin` so hooks apply to the parent instance (not encapsulated).
 *
 *   import Fastify from 'fastify';
 *   import { openzlFastify } from 'openzl-express/fastify';
 *
 *   const app = Fastify();
 *   await app.register(openzlFastify, { threshold: 1024 });
 *
 * gzip / br / zstd: streamed when the payload is a Node Readable (large
 * `reply.send(stream)` does not get buffered). Buffers/strings still go
 * through `compressBody`. OpenZL has no stream encoder — those bodies are
 * collected, then compressed.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Readable, type Transform } from 'stream';
import {
  createBrotliStream,
  createGzipStream,
  createZstdStream,
  isBrotliAvailable,
  isZstdAvailable,
  pickEncoding,
  type ContentEncoding,
  type OnCompressHook
} from '../core/index.js';
import {
  appendVary,
  compressBody,
  hasNoTransform,
  isCompressibleType,
  type SharedCodecOptions
} from './shared.js';

export type OpenZLFastifyOptions = SharedCodecOptions & {
  enabled?: boolean;
  filter?: (request: FastifyRequest, reply: FastifyReply) => boolean;
  selectProfile?: (
    request: FastifyRequest,
    payloadBytes: number
  ) => string | undefined;
  onError?: (error: Error, request: FastifyRequest, reply: FastifyReply) => void;
  /**
   * When OpenZL is negotiated but the payload is a stream, prefer gzip/br/zstd
   * streaming if the client also accepts them. OpenZL still has no stream encoder.
   * @default true
   */
  preferStreamGzip?: boolean;
};

const collectStream = (stream: Readable): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer | string) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });

const isNodeReadable = (payload: unknown): payload is Readable => {
  if (payload == null || Buffer.isBuffer(payload) || payload instanceof Uint8Array) {
    return false;
  }
  if (payload instanceof Readable) return true;
  return (
    typeof payload === 'object' &&
    typeof (payload as Readable).pipe === 'function' &&
    typeof (payload as Readable).on === 'function'
  );
};

const toBuffer = async (payload: unknown): Promise<Buffer | null> => {
  if (payload == null) return null;
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'string') return Buffer.from(payload);
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (isNodeReadable(payload)) return collectStream(payload);
  if (typeof payload === 'object') {
    return Buffer.from(JSON.stringify(payload));
  }
  return null;
};

const isPartialOrBodiless = (reply: FastifyReply): boolean => {
  const status = reply.statusCode;
  return (
    status === 204 ||
    status === 205 ||
    status === 304 ||
    status === 206 ||
    reply.getHeader('content-range') != null
  );
};

const pipeHeroStream = (
  source: Readable,
  which: 'gzip' | 'zstd' | 'br',
  opts: {
    zstdLevel?: number;
    brotliQuality?: number;
    onCompress?: OnCompressHook;
  }
): Transform => {
  const stream =
    which === 'zstd'
      ? createZstdStream(opts.zstdLevel)
      : which === 'br'
        ? createBrotliStream(opts.brotliQuality)
        : createGzipStream();

  let bytesIn = 0;
  let bytesOut = 0;
  const started = performance.now();

  source.on('data', (c: Buffer | string) => {
    bytesIn += Buffer.isBuffer(c) ? c.length : Buffer.byteLength(String(c));
  });
  stream.on('data', (c: Buffer) => {
    bytesOut += c.length;
  });
  stream.on('end', () => {
    if (!opts.onCompress) return;
    try {
      opts.onCompress({
        encoding: which,
        ratio: bytesIn > 0 ? (bytesOut / bytesIn) * 100 : 100,
        ms: performance.now() - started,
        bytesIn,
        bytesOut
      });
    } catch {
      // never let metrics hooks break the response
    }
  });
  source.on('error', (err: Error) => {
    stream.destroy(err);
  });
  stream.on('error', (err: Error) => {
    if (!source.destroyed) source.destroy(err);
  });
  source.pipe(stream);
  return stream;
};

const plugin: FastifyPluginAsync<OpenZLFastifyOptions> = async (
  fastify,
  options
) => {
  const {
    enabled = true,
    threshold = 1024,
    fallbackToGzip = true,
    profile = 'serial',
    allowZstd = isZstdAvailable(),
    zstdLevel,
    allowBrotli = isBrotliAvailable(),
    brotliQuality,
    debugHeaders = false,
    debug = false,
    filter,
    selectProfile,
    onError,
    onCompress,
    preferStreamGzip = true
  } = options;

  const log = (msg: string) => {
    if (debug) fastify.log.info({ msg: `[openzl] ${msg}` });
  };

  if (!enabled) return;

  const negotiate = (
    accept: string | string[] | undefined,
    extra: Parameters<typeof pickEncoding>[1] = {}
  ): ContentEncoding =>
    pickEncoding(accept, {
      allowZstd: allowZstd && isZstdAvailable(),
      allowBrotli: allowBrotli && isBrotliAvailable(),
      ...extra
    });

  fastify.addHook('onSend', async (request, reply, payload) => {
    const existing = reply.getHeader('content-encoding');
    if (existing && String(existing) !== 'identity') {
      return payload;
    }

    if (hasNoTransform(reply.getHeader('cache-control') as string | string[] | undefined)) {
      return payload;
    }

    if (isPartialOrBodiless(reply)) {
      return payload;
    }

    const type = String(reply.getHeader('content-type') ?? '');
    const allow = filter?.(request, reply) ?? isCompressibleType(type);
    if (!allow) return payload;

    reply.header(
      'vary',
      appendVary(reply.getHeader('vary') as string | string[] | undefined, 'Accept-Encoding')
    );

    const accept = request.headers['accept-encoding'];
    let encoding = negotiate(accept);
    if (encoding === 'identity') return payload;

    const streamed = isNodeReadable(payload);

    // OpenZL cannot stream. If the payload is a Readable and the client also
    // accepts a hero codec, use that instead of collecting the whole body.
    if (streamed && encoding === 'openzl' && preferStreamGzip) {
      const alt = negotiate(accept, { allowOpenZL: false });
      if (alt === 'gzip' || alt === 'zstd' || alt === 'br') {
        encoding = alt;
        log(`stream payload: prefer ${alt} over buffering for openzl`);
      }
    }

    if (streamed && (encoding === 'gzip' || encoding === 'zstd' || encoding === 'br')) {
      try {
        reply.removeHeader('content-length');
        reply.header('content-encoding', encoding);
        log(`${encoding} streaming`);
        return pipeHeroStream(payload, encoding, {
          zstdLevel,
          brotliQuality,
          onCompress
        });
      } catch (err) {
        const e = err as Error;
        onError?.(e, request, reply);
        log(`stream codec failed: ${e.message}`);
        return payload;
      }
    }

    let body: Buffer | null;
    try {
      body = await toBuffer(payload);
    } catch (err) {
      const e = err as Error;
      onError?.(e, request, reply);
      log(`payload collect failed: ${e.message}`);
      return payload;
    }
    if (!body || body.length === 0) return payload;

    try {
      const result = await compressBody(body, accept, {
        threshold,
        fallbackToGzip,
        profile,
        allowZstd,
        zstdLevel,
        allowBrotli,
        brotliQuality,
        onCompress,
        selectProfile: (size) => selectProfile?.(request, size)
      });

      if (result.encoding === 'identity') {
        return payload;
      }

      reply.header('content-encoding', result.encoding);
      reply.header('content-length', String(result.body.length));
      if (debugHeaders) {
        if (result.encoding === 'openzl' && result.profile) {
          reply.header('x-openzl-profile', result.profile);
          reply.header(
            'x-openzl-ratio',
            `${((result.body.length / body.length) * 100).toFixed(2)}%`
          );
          reply.header('x-original-size', String(body.length));
          reply.header('x-compressed-size', String(result.body.length));
        }
        if (result.fallbackFrom) {
          reply.header('x-compression-fallback', result.encoding);
          reply.header('x-openzl-error', result.fallbackFrom);
        }
      }

      log(`${result.encoding}: ${body.length} → ${result.body.length}`);
      return result.body;
    } catch (err) {
      const e = err as Error;
      onError?.(e, request, reply);
      log(`compress failed: ${e.message}`);
      return payload;
    }
  });
};

/** Encapsulated: false so parent routes inherit the onSend hook. */
export const openzlFastify = fp(plugin, {
  name: 'openzl-fastify',
  fastify: '4.x || 5.x'
});

export default openzlFastify;
