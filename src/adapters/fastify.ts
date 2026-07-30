/**
 * Fastify plugin — compresses onSend payloads with openzl | zstd | gzip.
 *
 * Uses `fastify-plugin` so hooks apply to the parent instance (not encapsulated).
 *
 *   import Fastify from 'fastify';
 *   import { openzlFastify } from 'openzl-express/fastify';
 *
 *   const app = Fastify();
 *   await app.register(openzlFastify, { threshold: 1024 });
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'stream';
import {
  isBrotliAvailable,
  isZstdAvailable,
  pickEncoding
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
  /** onCompress is inherited from SharedCodecOptions */
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

const toBuffer = async (payload: unknown): Promise<Buffer | null> => {
  if (payload == null) return null;
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'string') return Buffer.from(payload);
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (
    payload instanceof Readable ||
    (payload && typeof (payload as Readable).pipe === 'function')
  ) {
    return collectStream(payload as Readable);
  }
  if (typeof payload === 'object') {
    return Buffer.from(JSON.stringify(payload));
  }
  return null;
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
    debug = false,
    filter,
    selectProfile,
    onError,
    onCompress
  } = options;

  const log = (msg: string) => {
    if (debug) fastify.log.info({ msg: `[openzl] ${msg}` });
  };

  if (!enabled) return;

  fastify.addHook('onSend', async (request, reply, payload) => {
    const existing = reply.getHeader('content-encoding');
    if (existing && String(existing) !== 'identity') {
      return payload;
    }

    if (hasNoTransform(reply.getHeader('cache-control') as string | string[] | undefined)) {
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
    const probe = pickEncoding(accept, {
      allowZstd: allowZstd && isZstdAvailable(),
      allowBrotli: allowBrotli && isBrotliAvailable()
    });
    if (probe === 'identity') return payload;

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
