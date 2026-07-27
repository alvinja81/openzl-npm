/**
 * Thrown when the OpenZL CLI (zli) cannot be found or is a placeholder.
 */
export class OpenZLCLINotFoundError extends Error {
  constructor() {
    super(
      'OpenZL CLI (zli) not found. Install it with:\n' +
        '  npm install @amirja811/openzl-cli\n' +
        'Or build from source: https://github.com/facebook/openzl\n' +
        'Servers without zli can still use gzip via content negotiation.'
    );
    this.name = 'OpenZLCLINotFoundError';
  }
}

/**
 * Thrown when OpenZL compress or decompress fails.
 */
export class CompressionError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(`OpenZL operation failed: ${message}`);
    this.name = 'CompressionError';
  }
}
