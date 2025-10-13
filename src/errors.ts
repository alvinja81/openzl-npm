/**
 * Custom error class for OpenZL CLI not found
 */
export class OpenZLCLINotFoundError extends Error {
  constructor() {
    super(
      'OpenZL CLI (zli) not found. Please install it first:\n' +
      '  npm install -g @openzl/cli\n' +
      'Or visit: https://github.com/openzl/openzl for installation instructions.'
    );
    this.name = 'OpenZLCLINotFoundError';
  }
}

/**
 * Custom error class for compression failures
 */
export class CompressionError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(`OpenZL compression failed: ${message}`);
    this.name = 'CompressionError';
  }
}



