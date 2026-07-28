/**
 * Structured errors for OpenZL / multi-codec operations.
 *
 * All library failures should surface as one of these types (or subclasses)
 * so callers can branch on `code` without parsing message strings.
 */

export type OpenZLErrorCode =
  | 'CLI_NOT_FOUND'
  | 'COMPRESSION_FAILED'
  | 'DECOMPRESSION_FAILED'
  | 'INPUT_TOO_LARGE'
  | 'OUTPUT_TOO_LARGE'
  | 'TIMEOUT'
  | 'INVALID_FRAME'
  | 'PROFILE_NOT_FOUND';

/**
 * Base class — prefer checking `err instanceof CompressionError` or `err.code`.
 */
export class OpenZLError extends Error {
  readonly code: OpenZLErrorCode;
  readonly originalError?: Error;

  constructor(
    message: string,
    code: OpenZLErrorCode,
    originalError?: Error
  ) {
    super(message);
    this.name = 'OpenZLError';
    this.code = code;
    this.originalError = originalError;
  }
}

/**
 * Thrown when the OpenZL CLI (zli) cannot be found or is a placeholder.
 */
export class OpenZLCLINotFoundError extends OpenZLError {
  constructor() {
    super(
      'OpenZL CLI (zli) not found. Install it with:\n' +
        '  npm install @amirja811/openzl-cli\n' +
        'Or build from source: https://github.com/facebook/openzl\n' +
        'Servers without zli can still use gzip via content negotiation.',
      'CLI_NOT_FOUND'
    );
    this.name = 'OpenZLCLINotFoundError';
  }
}

/**
 * Thrown when OpenZL compress or decompress fails (or a limit is hit).
 * Message is prefixed with "OpenZL operation failed:" for back-compat.
 */
export class CompressionError extends OpenZLError {
  constructor(
    message: string,
    originalErrorOrCode?: Error | OpenZLErrorCode,
    code?: OpenZLErrorCode
  ) {
    let originalError: Error | undefined;
    let resolvedCode: OpenZLErrorCode = 'COMPRESSION_FAILED';

    if (typeof originalErrorOrCode === 'string') {
      resolvedCode = originalErrorOrCode;
    } else if (originalErrorOrCode instanceof Error) {
      originalError = originalErrorOrCode;
      if (code) resolvedCode = code;
    } else if (code) {
      resolvedCode = code;
    }

    super(`OpenZL operation failed: ${message}`, resolvedCode, originalError);
    this.name = 'CompressionError';
  }
}

/**
 * Limit / safety violations (bomb protection, timeouts).
 * Subclass of CompressionError so existing `instanceof CompressionError` still works.
 */
export class LimitError extends CompressionError {
  constructor(
    code: 'INPUT_TOO_LARGE' | 'OUTPUT_TOO_LARGE' | 'TIMEOUT',
    message: string
  ) {
    super(message, code);
    this.name = 'LimitError';
  }
}

/**
 * Decompress-specific failure (malformed frame, codec error).
 */
export class DecompressionError extends CompressionError {
  constructor(message: string, originalError?: Error, code: OpenZLErrorCode = 'DECOMPRESSION_FAILED') {
    super(message, originalError, code);
    this.name = 'DecompressionError';
  }
}

/** Type guard: any structured library error. */
export const isOpenZLError = (err: unknown): err is OpenZLError =>
  err instanceof OpenZLError;
