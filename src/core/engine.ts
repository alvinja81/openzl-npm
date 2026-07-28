/**
 * OpenZL compress / decompress engine.
 *
 * Fallback chain:
 *   1. Native N-API addon (serial + trained .zlc via in-process deserialize)
 *   2. Persistent worker pool → one-shot native zli over pipes (serial only)
 *   3. One-shot CLI pipe with `-p` / `-c` (any profile)
 *
 * Phase 3: profile is configurable via CompressOptions.
 */

import fs from 'fs/promises';
import { findZliPath, checkCLIAvailable, resetCLICache as resetPathCache } from './cli-path.js';
import { runZliPipe } from './pipe-runner.js';
import { ensurePool, shutdownPool, resetPool } from './pool.js';
import { getNative, resetNativeCache } from './native.js';
import { resolveProfile, resetProfileCache, type ResolvedProfile } from './profiles.js';
import {
  OpenZLCLINotFoundError,
  CompressionError,
  DecompressionError,
  LimitError
} from './errors.js';

export { checkCLIAvailable } from './cli-path.js';
export { isNativeAvailable, getNativeLoadError } from './native.js';
export {
  listProfiles,
  resolveProfile,
  suggestProfile,
  getProfilesRoot,
  type ResolvedProfile
} from './profiles.js';

/** Default max compressed input (64 MiB). */
export const DEFAULT_MAX_INPUT_BYTES = 64 * 1024 * 1024;
/** Default max decompressed output (256 MiB). */
export const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
/** Default op timeout (30s). */
export const DEFAULT_TIMEOUT_MS = 30_000;

export type CompressOptions = {
  /**
   * Profile name from the shipped manifest (`serial`, `timeseries`, …),
   * a builtin CLI profile (`le-u32`, `csv`, …), or a path to a `.zlc` file.
   * @default 'serial'
   */
  profile?: string;

  /** Abort compress if it exceeds this many ms. @default 30000 */
  timeoutMs?: number;
};

/**
 * Safety limits for {@link decompress}. Protects against zip-bomb style frames
 * and runaway CLI/native work.
 */
export type DecompressOptions = {
  /**
   * Reject compressed input larger than this (bytes).
   * @default 64 MiB
   */
  maxInputBytes?: number;

  /**
   * Reject (after decode) if output exceeds this (bytes).
   * @default 256 MiB
   */
  maxOutputBytes?: number;

  /**
   * Abort decompress if it exceeds this many ms.
   * @default 30000
   */
  timeoutMs?: number;
};

/** True when this profile can use the in-process serial native path. */
const isDefaultSerial = (resolved: ResolvedProfile): boolean =>
  resolved.kind === 'builtin' &&
  (resolved.cliProfile === 'serial' || resolved.name === 'serial') &&
  !resolved.compressorPath;

let exitHooksInstalled = false;

const installExitHooks = (): void => {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;

  const cleanupSync = (): void => {
    void shutdownPool();
  };

  process.once('beforeExit', cleanupSync);
  process.once('exit', cleanupSync);

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      void shutdownPool().finally(() => process.exit(0));
    });
  }
};

/**
 * Clear cached CLI path, native loader, profiles, and worker pool.
 */
export const resetCLICache = (): void => {
  resetPathCache();
  resetNativeCache();
  resetProfileCache();
  zlcCache.clear();
  void resetPool();
};

/** Graceful shutdown of the worker pool (e.g. on server close). */
export const shutdownOpenZL = async (): Promise<void> => {
  await shutdownPool();
};

export type BackendKind = 'native' | 'pool' | 'cli-pipe';

/**
 * Which backend would handle the next compress call for this profile.
 */
export const getActiveBackend = async (
  options: CompressOptions = {}
): Promise<BackendKind | 'unavailable'> => {
  let resolved: ResolvedProfile;
  try {
    resolved = resolveProfile(options.profile ?? 'serial');
  } catch {
    return 'unavailable';
  }

  if (isDefaultSerial(resolved) && getNative()) return 'native';
  if (
    resolved.kind === 'trained' &&
    resolved.compressorPath &&
    getNative()?.compressTrained
  ) {
    return 'native';
  }

  try {
    const zliPath = await findZliPath();
    if (isDefaultSerial(resolved)) {
      const pool = await ensurePool({ zliPath });
      if (pool && pool.workerCount > 0) return 'pool';
    }
    return 'cli-pipe';
  } catch {
    return 'unavailable';
  }
};

// Cached .zlc bytes per trained-profile name (files are small, immutable assets)
const zlcCache = new Map<string, Buffer>();

const readZlc = async (name: string, compressorPath: string): Promise<Buffer> => {
  let zlc = zlcCache.get(name);
  if (!zlc) {
    zlc = await fs.readFile(compressorPath);
    zlcCache.set(name, zlc);
  }
  return zlc;
};

/**
 * Race a promise against a wall-clock timeout. On timeout, rejects with LimitError
 * but does not cancel native work (N-API has no abort hook yet).
 */
const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new LimitError('TIMEOUT', `${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    // Don't keep the process alive solely for the timer
    timer.unref?.();

    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
};

const runCompress = async (buffer: Buffer, options: CompressOptions): Promise<Buffer> => {
  const resolved = resolveProfile(options.profile ?? 'serial');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 1a. Native trained — deserialize .zlc in-process (cached in-addon by name)
  if (resolved.kind === 'trained' && resolved.compressorPath) {
    const native = getNative();
    if (native?.compressTrained) {
      try {
        const zlc = await readZlc(resolved.name, resolved.compressorPath);
        return await withTimeout(
          native.compressTrained(resolved.name, zlc, buffer),
          timeoutMs,
          'compress'
        );
      } catch (err) {
        if (err instanceof LimitError) throw err;
        if (process.env.OPENZL_DEBUG) {
          console.warn(
            '[OpenZL] native trained path failed, falling back to CLI:',
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  }

  // 1b. Native — default serial
  if (isDefaultSerial(resolved)) {
    const native = getNative();
    if (native) {
      try {
        return await withTimeout(native.compress(buffer), timeoutMs, 'compress');
      } catch (err) {
        if (err instanceof LimitError) throw err;
        if (process.env.OPENZL_DEBUG) {
          console.warn(
            '[OpenZL] native path failed, falling back to CLI:',
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    // 2. Worker pool (serial only)
    try {
      const zliPath = await findZliPath();
      const pool = await ensurePool({ zliPath, timeoutMs });
      if (pool && pool.workerCount > 0) {
        installExitHooks();
        return await withTimeout(pool.compress(buffer), timeoutMs, 'compress');
      }
    } catch (err) {
      if (err instanceof LimitError) throw err;
      // fall through
    }
  }

  // 3. One-shot CLI with -p / -c
  const zliPath = await findZliPath();
  return runZliPipe(zliPath, 'compress', buffer, {
    profile: resolved.cliProfile,
    compressorPath: resolved.compressorPath,
    timeoutMs
  });
};

const runDecompress = async (
  buffer: Buffer,
  options: Required<
    Pick<DecompressOptions, 'maxInputBytes' | 'maxOutputBytes' | 'timeoutMs'>
  >
): Promise<Buffer> => {
  const { maxInputBytes, maxOutputBytes, timeoutMs } = options;

  if (buffer.length > maxInputBytes) {
    throw new LimitError(
      'INPUT_TOO_LARGE',
      `compressed input ${buffer.length} bytes exceeds maxInputBytes=${maxInputBytes}`
    );
  }

  if (buffer.length === 0) {
    throw new DecompressionError('empty input', undefined, 'INVALID_FRAME');
  }

  const checkOut = (out: Buffer): Buffer => {
    if (out.length > maxOutputBytes) {
      throw new LimitError(
        'OUTPUT_TOO_LARGE',
        `decompressed output ${out.length} bytes exceeds maxOutputBytes=${maxOutputBytes}`
      );
    }
    return out;
  };

  // Universal decompressor — native first, then CLI
  const native = getNative();
  if (native) {
    try {
      const out = await withTimeout(native.decompress(buffer), timeoutMs, 'decompress');
      return checkOut(out);
    } catch (err) {
      if (err instanceof LimitError) throw err;
      if (process.env.OPENZL_DEBUG) {
        console.warn(
          '[OpenZL] native decompress failed, falling back to CLI:',
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  const zliPath = await findZliPath();
  try {
    const pool = await ensurePool({ zliPath, timeoutMs });
    if (pool && pool.workerCount > 0) {
      installExitHooks();
      const out = await withTimeout(pool.decompress(buffer), timeoutMs, 'decompress');
      return checkOut(out);
    }
  } catch (err) {
    if (err instanceof LimitError) throw err;
    // fall through
  }

  const out = await runZliPipe(zliPath, 'decompress', buffer, { timeoutMs });
  return checkOut(out);
};

/**
 * Compress bytes with OpenZL.
 * @param options.profile Profile name, builtin, or path to `.zlc`
 */
export const compress = async (
  buffer: Buffer,
  options: CompressOptions = {}
): Promise<Buffer> => {
  try {
    return await runCompress(buffer, options);
  } catch (error) {
    if (
      error instanceof OpenZLCLINotFoundError ||
      error instanceof CompressionError ||
      error instanceof LimitError
    ) {
      throw error;
    }
    throw new CompressionError(
      error instanceof Error ? error.message : 'Unknown error',
      error instanceof Error ? error : undefined
    );
  }
};

/**
 * Decompress an OpenZL (.zl) frame to raw bytes.
 * Profile is not needed — the frame embeds the graph.
 *
 * Safety limits (max input/output size, timeout) apply by default.
 */
export const decompress = async (
  buffer: Buffer,
  options: DecompressOptions = {}
): Promise<Buffer> => {
  const limits = {
    maxInputBytes: options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  };

  try {
    return await runDecompress(buffer, limits);
  } catch (error) {
    if (
      error instanceof OpenZLCLINotFoundError ||
      error instanceof LimitError ||
      error instanceof DecompressionError
    ) {
      throw error;
    }
    // Promote generic CompressionError (CLI/native) to decompress-specific
    if (error instanceof CompressionError) {
      throw new DecompressionError(
        error.message.replace(/^OpenZL operation failed:\s*/, ''),
        error.originalError ?? error,
        error.code === 'COMPRESSION_FAILED' ? 'DECOMPRESSION_FAILED' : error.code
      );
    }
    throw new DecompressionError(
      error instanceof Error ? error.message : 'Unknown error',
      error instanceof Error ? error : undefined
    );
  }
};

/** @deprecated Prefer {@link compress} */
export const compressWithOpenZL = compress;

/** @deprecated Prefer {@link decompress} */
export const decompressWithOpenZL = decompress;
