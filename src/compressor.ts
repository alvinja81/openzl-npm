import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { OpenZLCLINotFoundError, CompressionError } from './errors.js';

const execFileAsync = promisify(execFile);

const CLI_PATHS = [
  'zli', // Global install
  path.join(process.cwd(), 'node_modules', '.bin', 'zli'), // Local install (npm)
  path.join(process.cwd(), 'node_modules', '@openzl', 'cli', 'bin', 'zli'), // @openzl/cli package
  path.join(process.cwd(), 'openzl', 'build', 'cli', 'zli'), // Local install (make)
  // Add more paths as needed, e.g., for different OS or custom install locations
];

/**
 * Find the OpenZL CLI (zli) executable
 */
const findZliPath = async (): Promise<string> => {
  for (const cliPath of CLI_PATHS) {
    try {
      await execFileAsync(cliPath, ['--version']);
      return cliPath;
    } catch (error) {
      // Continue to next path
    }
  }
  throw new OpenZLCLINotFoundError();
};

/**
 * Check if OpenZL CLI (zli) is available
 */
export const checkCLIAvailable = async (): Promise<boolean> => {
  try {
    await findZliPath();
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Compress data using OpenZL CLI
 * @param buffer - The data to compress
 * @returns Compressed buffer
 * @throws {OpenZLCLINotFoundError} If zli CLI is not installed
 * @throws {CompressionError} If compression fails
 */
export const compressWithOpenZL = async (buffer: Buffer): Promise<Buffer> => {
  const zliPath = await findZliPath();

  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);
  const inputPath = path.join(tmpdir(), `openzl-input-${timestamp}-${randomId}.json`);
  const outputPath = path.join(tmpdir(), `openzl-output-${timestamp}-${randomId}.zl`);

  try {
    // Write input data to temp file
    await fs.writeFile(inputPath, buffer);

    // Run OpenZL compression with serial profile (for JSON data)
    await execFileAsync(zliPath, ['compress', inputPath, '-o', outputPath, '-p', 'serial']);

    // Read compressed output
    const compressedData = await fs.readFile(outputPath);

    // Cleanup temp files
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {})
    ]);

    return compressedData;
  } catch (error) {
    // Cleanup on error
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {})
    ]);

    throw new CompressionError(
      error instanceof Error ? error.message : 'Unknown error',
      error instanceof Error ? error : undefined
    );
  }
};



