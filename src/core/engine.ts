import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { OpenZLCLINotFoundError, CompressionError } from './errors.js';

const execFileAsync = promisify(execFile);

const isWindows = process.platform === 'win32';

const CLI_PATHS = [
  'zli',
  ...(isWindows ? ['zli.cmd'] : []),
  path.join(process.cwd(), 'node_modules', '.bin', isWindows ? 'zli.cmd' : 'zli'),
  path.join(process.cwd(), 'node_modules', 'openzl-cli', 'bin', 'zli'),
  path.join(process.cwd(), 'node_modules', '@amirja811', 'openzl-cli', 'bin', 'zli'),
  path.join(process.cwd(), 'openzl', 'build', 'cli', 'zli')
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
 * Clear the cached CLI location (tests, or after installing CLI without restart).
 */
export const resetCLICache = (): void => {
  cachedZliPath = undefined;
  zliLookup = undefined;
};

/**
 * Check whether the OpenZL CLI (zli) is available.
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
 * Compress bytes with OpenZL (serial profile — safe opaque byte stream).
 * @throws {OpenZLCLINotFoundError} If zli is not installed
 * @throws {CompressionError} If compression fails
 */
export const compress = async (buffer: Buffer): Promise<Buffer> => {
  const zliPath = await findZliPath();
  const { inputPath, outputPath } = makeTempPaths('.bin');

  try {
    await fs.writeFile(inputPath, buffer);
    await execFileAsync(zliPath, ['compress', inputPath, '-o', outputPath, '-p', 'serial'], {
      timeout: 30000
    });
    return await fs.readFile(outputPath);
  } catch (error) {
    if (error instanceof OpenZLCLINotFoundError) throw error;
    throw new CompressionError(
      error instanceof Error ? error.message : 'Unknown error',
      error instanceof Error ? error : undefined
    );
  } finally {
    await cleanup(inputPath, outputPath);
  }
};

/**
 * Decompress an OpenZL (.zl) frame to raw bytes.
 * @throws {OpenZLCLINotFoundError} If zli is not installed
 * @throws {CompressionError} If decompression fails
 */
export const decompress = async (buffer: Buffer): Promise<Buffer> => {
  const zliPath = await findZliPath();
  const { inputPath, outputPath } = makeTempPaths('.zl');

  try {
    await fs.writeFile(inputPath, buffer);
    await execFileAsync(zliPath, ['decompress', inputPath, '-o', outputPath], {
      timeout: 30000
    });
    return await fs.readFile(outputPath);
  } catch (error) {
    if (error instanceof OpenZLCLINotFoundError) throw error;
    throw new CompressionError(
      error instanceof Error ? error.message : 'Unknown error',
      error instanceof Error ? error : undefined
    );
  } finally {
    await cleanup(inputPath, outputPath);
  }
};

/** @deprecated Prefer {@link compress} */
export const compressWithOpenZL = compress;

/** @deprecated Prefer {@link decompress} */
export const decompressWithOpenZL = decompress;
