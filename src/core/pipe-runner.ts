/**
 * One-shot zli compress/decompress over stdin/stdout (no temp files).
 *
 * Uses `/dev/stdin` + `/dev/stdout` on Unix. Windows falls back to temp files
 * because those device paths are not available the same way.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { CompressionError } from './errors.js';

export type PipeOp = 'compress' | 'decompress';

export type PipeCompressOptions = {
  /** Builtin profile name (`serial`, `le-u32`, …). Ignored if compressorPath set. */
  profile?: string;
  /** Path to a trained/serialized compressor (.zlc). Wins over profile. */
  compressorPath?: string;
  timeoutMs?: number;
};

const USE_DEV_STDIO = process.platform !== 'win32';

const collect = (stream: NodeJS.ReadableStream): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });

const compressArgs = (
  input: string,
  output: string,
  options: { profile?: string; compressorPath?: string }
): string[] => {
  const args = ['--verbose', '0', 'compress', input, '-o', output, '-f'];
  if (options.compressorPath) {
    args.push('-c', options.compressorPath);
  } else {
    args.push('-p', options.profile ?? 'serial');
  }
  return args;
};

/**
 * Run zli once with the given op. Prefer native binary path (see cli-path.ts).
 */
export const runZliPipe = (
  zliPath: string,
  op: PipeOp,
  input: Buffer,
  options: PipeCompressOptions = {}
): Promise<Buffer> => {
  const { profile = 'serial', compressorPath, timeoutMs = 30_000 } = options;

  if (!USE_DEV_STDIO) {
    return runZliTempFiles(zliPath, op, input, { profile, compressorPath, timeoutMs });
  }

  const args =
    op === 'compress'
      ? compressArgs('/dev/stdin', '/dev/stdout', { profile, compressorPath })
      : ['--verbose', '0', 'decompress', '/dev/stdin', '-o', '/dev/stdout', '-f'];

  return new Promise((resolve, reject) => {
    const child = spawn(zliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new CompressionError(`zli ${op} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const stdoutP = collect(child.stdout!);
    const stderrP = collect(child.stderr!);

    child.on('error', (err) => {
      clearTimeout(timer);
      fail(new CompressionError(`Failed to spawn zli: ${err.message}`, err));
    });

    child.on('close', async (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      try {
        const [stdout, stderr] = await Promise.all([stdoutP, stderrP]);
        if (code !== 0) {
          const msg = stderr.toString('utf8').trim() || `zli ${op} exited with code ${code}`;
          reject(new CompressionError(msg));
          return;
        }
        resolve(stdout);
      } catch (err) {
        reject(
          err instanceof CompressionError
            ? err
            : new CompressionError(err instanceof Error ? err.message : String(err))
        );
      }
    });

    child.stdin!.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
        fail(new CompressionError(`stdin error: ${err.message}`, err));
      }
    });

    child.stdin!.end(input);
  });
};

const cleanup = (...paths: string[]): Promise<unknown> =>
  Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));

const runZliTempFiles = async (
  zliPath: string,
  op: PipeOp,
  input: Buffer,
  options: { profile?: string; compressorPath?: string; timeoutMs: number }
): Promise<Buffer> => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(tmpdir(), `openzl-in-${id}.bin`);
  const outputPath = path.join(tmpdir(), `openzl-out-${id}.bin`);

  try {
    await fs.writeFile(inputPath, input);
    const args =
      op === 'compress'
        ? compressArgs(inputPath, outputPath, options)
        : ['--verbose', '0', 'decompress', inputPath, '-o', outputPath, '-f'];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(zliPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      const errChunks: Buffer[] = [];
      child.stderr?.on('data', (c: Buffer) => errChunks.push(c));
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new CompressionError(`zli ${op} timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new CompressionError(`Failed to spawn zli: ${err.message}`, err));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const msg =
            Buffer.concat(errChunks).toString('utf8').trim() ||
            `zli ${op} exited with code ${code}`;
          reject(new CompressionError(msg));
          return;
        }
        resolve();
      });
    });

    return await fs.readFile(outputPath);
  } finally {
    await cleanup(inputPath, outputPath);
  }
};
