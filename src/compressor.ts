import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { OpenZLCLINotFoundError, CompressionError } from './errors.js';

const execFileAsync = promisify(execFile);

const isWindows = process.platform === 'win32';

const CLI_PATHS = [
  'zli', // Global install (on PATH)
  ...(isWindows ? ['zli.cmd'] : []), // npm bin shim on Windows
  path.join(process.cwd(), 'node_modules', '.bin', isWindows ? 'zli.cmd' : 'zli'), // Local install
  path.join(process.cwd(), 'node_modules', 'openzl-cli', 'bin', 'zli'), // openzl-cli package
  path.join(process.cwd(), 'node_modules', '@amirja811', 'openzl-cli', 'bin', 'zli'), // scoped package
  path.join(process.cwd(), 'openzl', 'build', 'cli', 'zli'), // Local build (make)
];

/**
 * Verify a candidate zli executable actually works.
 * Older openzl-cli packages shipped placeholder scripts that print an error
 * but exit 0, so a successful exit code alone is not enough.
 */
const isRealZli = async (cliPath: string): Promise<boolean> => {
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, ['--version'], {
      timeout: 5000
    });
    const output = `${stdout}${stderr}`;
    return !/binary not available|placeholder/i.test(output);
  } catch {
    return false;
  }
};

let cachedZliPath: string | null | undefined;
let zliLookup: Promise<string | null> | undefined;

/**
 * Find the OpenZL CLI (zli) executable. The result is cached for the
 * lifetime of the process so we don't spawn `zli --version` per request.
 */
const findZliPath = async (): Promise<string> => {
  if (cachedZliPath !== undefined) {
    if (cachedZliPath === null) throw new OpenZLCLINotFoundError();
    return cachedZliPath;
  }

  if (!zliLookup) {
    zliLookup = (async () => {
      for (const cliPath of CLI_PATHS) {
        if (await isRealZli(cliPath)) {
          return cliPath;
        }
      }
      return null;
    })();
  }

  cachedZliPath = await zliLookup;
  if (cachedZliPath === null) throw new OpenZLCLINotFoundError();
  return cachedZliPath;
};

/**
 * Clear the cached CLI location (mainly useful in tests, or after
 * installing the CLI without restarting the process).
 */
export const resetCLICache = (): void => {
  cachedZliPath = undefined;
  zliLookup = undefined;
};

/**
 * Check if OpenZL CLI (zli) is available
 */
export const checkCLIAvailable = async (): Promise<boolean> => {
  try {
    await findZliPath();
    return true;
  } catch {
    return false;
  }
};

const makeTempPaths = (ext: string): { inputPath: string; outputPath: string } => {
  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  return {
    inputPath: path.join(tmpdir(), `openzl-input-${id}${ext}`),
    outputPath: path.join(tmpdir(), `openzl-output-${id}.out`)
  };
};

const cleanup = (...paths: string[]): Promise<unknown> =>
  Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));

/**
 * Compress data using OpenZL CLI
 * @param buffer - The data to compress
 * @returns Compressed buffer
 * @throws {OpenZLCLINotFoundError} If zli CLI is not installed
 * @throws {CompressionError} If compression fails
 */
export const compressWithOpenZL = async (buffer: Buffer): Promise<Buffer> => {
  const zliPath = await findZliPath();
  const { inputPath, outputPath } = makeTempPaths('.json');

  try {
    await fs.writeFile(inputPath, buffer);

    // Serial profile: treats input as an opaque byte stream (safe for JSON)
    await execFileAsync(zliPath, ['compress', inputPath, '-o', outputPath, '-p', 'serial'], {
      timeout: 30000
    });

    return await fs.readFile(outputPath);
  } catch (error) {
    throw new CompressionError(
      error instanceof Error ? error.message : 'Unknown error',
      error instanceof Error ? error : undefined
    );
  } finally {
    await cleanup(inputPath, outputPath);
  }
};

/**
 * Decompress OpenZL data using the CLI.
 * Useful for Node.js clients consuming `Content-Encoding: openzl` responses.
 * @param buffer - OpenZL-compressed data (.zl frame)
 * @returns Decompressed buffer
 * @throws {OpenZLCLINotFoundError} If zli CLI is not installed
 * @throws {CompressionError} If decompression fails
 */
export const decompressWithOpenZL = async (buffer: Buffer): Promise<Buffer> => {
  const zliPath = await findZliPath();
  const { inputPath, outputPath } = makeTempPaths('.zl');

  try {
    await fs.writeFile(inputPath, buffer);

    await execFileAsync(zliPath, ['decompress', inputPath, '-o', outputPath], {
      timeout: 30000
    });

    return await fs.readFile(outputPath);
  } catch (error) {
    throw new CompressionError(
      error instanceof Error ? error.message : 'Unknown error',
      error instanceof Error ? error : undefined
    );
  } finally {
    await cleanup(inputPath, outputPath);
  }
};
