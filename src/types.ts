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
