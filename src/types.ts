import type { Request, Response, NextFunction } from 'express';

/**
 * Configuration options for OpenZL middleware
 */
export interface OpenZLMiddlewareOptions {
  /**
   * Enable or disable compression (default: true)
   */
  enabled?: boolean;

  /**
   * Minimum response size in bytes to trigger compression (default: 1024)
   */
  threshold?: number;

  /**
   * Enable fallback to gzip if OpenZL fails (default: true)
   */
  fallbackToGzip?: boolean;

  /**
   * Custom error handler for compression failures
   */
  onError?: (error: Error, req: Request, res: Response) => void;

  /**
   * Enable debug logging (default: false)
   */
  debug?: boolean;
}

/**
 * Compression result metadata
 */
export interface CompressionResult {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  method: 'openzl' | 'gzip' | 'none';
}

/**
 * Express middleware function type
 */
export type ExpressMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void;



