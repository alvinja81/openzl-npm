/**
 * Optional N-API OpenZL bindings loader.
 *
 * Never throws on import — if the addon is missing or fails to load,
 * all helpers report unavailable and the engine falls back to the CLI pool.
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

export type NativeOpenZL = {
  compress: (buf: Buffer) => Promise<Buffer>;
  /** Compress with a deserialized trained compressor (cached in-addon by key). */
  compressTrained?: (key: string, zlc: Buffer, data: Buffer) => Promise<Buffer>;
  decompress: (buf: Buffer) => Promise<Buffer>;
  compressSync: (buf: Buffer) => Buffer;
  decompressSync: (buf: Buffer) => Buffer;
  isAvailable: () => boolean;
  backend: string;
};

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const platformKey = `${process.platform}-${process.arch}`;

/** Candidate paths for the compiled .node binary (prebuild → local build). */
const CANDIDATES = [
  // Published / install-native prebuilds
  path.resolve(here, '../../prebuilds', platformKey, 'openzl_native.node'),
  path.resolve(process.cwd(), 'prebuilds', platformKey, 'openzl_native.node'),
  // cmake-js local builds
  path.resolve(here, '../../native/build/Release/openzl_native.node'),
  path.resolve(here, '../../native/build/Debug/openzl_native.node'),
  path.resolve(process.cwd(), 'native/build/Release/openzl_native.node'),
  path.resolve(process.cwd(), 'native/build/Debug/openzl_native.node')
];

let cached: NativeOpenZL | null | undefined;
let loadError: string | undefined;

const tryLoad = (): NativeOpenZL | null => {
  if (process.env.OPENZL_NATIVE === '0') {
    loadError = 'disabled via OPENZL_NATIVE=0';
    return null;
  }

  const tried: string[] = [];
  for (const p of CANDIDATES) {
    tried.push(p);
    if (!existsSync(p)) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(p) as NativeOpenZL;
      if (mod && typeof mod.compress === 'function' && mod.isAvailable()) {
        return mod;
      }
      loadError = `loaded ${p} but isAvailable() returned false`;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!loadError) {
    loadError = `native addon not found (tried ${tried.length} paths)`;
  }
  return null;
};

/** Lazy-load and cache the native addon (or null). */
export const getNative = (): NativeOpenZL | null => {
  if (cached !== undefined) return cached;
  cached = tryLoad();
  return cached;
};

export const isNativeAvailable = (): boolean => getNative() !== null;

export const getNativeLoadError = (): string | undefined => {
  getNative();
  return loadError;
};

/** Clear cache (tests). */
export const resetNativeCache = (): void => {
  cached = undefined;
  loadError = undefined;
};
