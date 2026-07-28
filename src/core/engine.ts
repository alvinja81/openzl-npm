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
import { OpenZLCLINotFoundError, CompressionError } from './errors.js';

export { checkCLIAvailable } from './cli-path.js';
export { isNativeAvailable, getNativeLoadError } from './native.js';
export {
  listProfiles,
  resolveProfile,
  suggestProfile,
  getProfilesRoot,
  type ResolvedProfile
} from './profiles.js';

export type CompressOptions = {
  /**
   * Profile name from the shipped manifest (`serial`, `timeseries`, …),
   * a builtin CLI profile (`le-u32`, `csv`, …), or a path to a `.zlc` file.
   * @default 'serial'
   */
  profile?: string;
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

const runCompress = async (buffer: Buffer, options: CompressOptions): Promise<Buffer> => {
  const resolved = resolveProfile(options.profile ?? 'serial');

  // 1a. Native trained — deserialize .zlc in-process (cached in-addon by name)
  if (resolved.kind === 'trained' && resolved.compressorPath) {
    const native = getNative();
    if (native?.compressTrained) {
      try {
        const zlc = await readZlc(resolved.name, resolved.compressorPath);
        return await native.compressTrained(resolved.name, zlc, buffer);
      } catch (err) {
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
        return await native.compress(buffer);
      } catch (err) {
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
      const pool = await ensurePool({ zliPath });
      if (pool && pool.workerCount > 0) {
        installExitHooks();
        return pool.compress(buffer);
      }
    } catch {
      // fall through
    }
  }

  // 3. One-shot CLI with -p / -c
  const zliPath = await findZliPath();
  return runZliPipe(zliPath, 'compress', buffer, {
    profile: resolved.cliProfile,
    compressorPath: resolved.compressorPath
  });
};

const runDecompress = async (buffer: Buffer): Promise<Buffer> => {
  // Universal decompressor — native first, then CLI
  const native = getNative();
  if (native) {
    try {
      return await native.decompress(buffer);
    } catch (err) {
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
    const pool = await ensurePool({ zliPath });
    if (pool && pool.workerCount > 0) {
      installExitHooks();
      return pool.decompress(buffer);
    }
  } catch {
    // fall through
  }

  return runZliPipe(zliPath, 'decompress', buffer);
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
    if (error instanceof OpenZLCLINotFoundError || error instanceof CompressionError) {
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
 */
export const decompress = async (buffer: Buffer): Promise<Buffer> => {
  try {
    return await runDecompress(buffer);
  } catch (error) {
    if (error instanceof OpenZLCLINotFoundError || error instanceof CompressionError) {
      throw error;
    }
    throw new CompressionError(
      error instanceof Error ? error.message : 'Unknown error',
      error instanceof Error ? error : undefined
    );
  }
};

/** @deprecated Prefer {@link compress} */
export const compressWithOpenZL = compress;

/** @deprecated Prefer {@link decompress} */
export const decompressWithOpenZL = decompress;
