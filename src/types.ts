import type { Request, Response, NextFunction } from 'express';

/**
 * Configuration options for OpenZL Express middleware.
 */
export interface OpenZLMiddlewareOptions {
  /** Enable or disable compression (default: true) */
  enabled?: boolean;

  /** Minimum response size in bytes to compress (default: 1024) */
  threshold?: number;

  /** Fallback to gzip if OpenZL fails (default: true) */
  fallbackToGzip?: boolean;

  /**
   * OpenZL profile: shipped name (`serial`, `timeseries`, `api-list`, …),
   * a builtin CLI profile, or a path to a `.zlc` file.
   * @default 'serial'
   */
  profile?: string;

  /**
   * Per-request profile selection. Wins over `profile` when it returns a name.
   * Use for route- or content-shape-specific compressors.
   */
  selectProfile?: (req: Request, body: unknown, jsonBytes: number) => string | undefined;

  /**
   * Whether this response should be compressed (default: compressible types).
   * Called after route handlers typically set Content-Type (on first write/end).
   */
  filter?: (req: Request, res: Response) => boolean;

  /**
   * When OpenZL is negotiated but the response is streamed (`write`/`sendFile`),
   * prefer **gzip/zstd streaming** for TTFB if the client also accepts them.
   * OpenZL still has no true stream encoder in this package.
   * @default true
   */
  preferStreamGzip?: boolean;

  /**
   * Allow zstd when the runtime and client support it.
   * Default: true if `zlib.zstdCompress` exists.
   */
  allowZstd?: boolean;

  /** Zstd compression level (Node zlib params). Default: zlib default. */
  zstdLevel?: number;

  /** Custom error handler for compression failures */
  onError?: (error: Error, req: Request, res: Response) => void;

  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Express middleware function type.
 */
export type ExpressMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void;

// Re-export core types so existing imports keep working
export type { CompressionResult, ContentEncoding, PickEncodingOptions } from './core/types.js';
