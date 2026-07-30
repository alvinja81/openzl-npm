/**
 * Prebuild target identification, shared by install-native.mjs and its tests.
 */

import fs from 'fs';
import { createRequire } from 'module';

/**
 * True on musl-based Linux (Alpine). A glibc-linked .node cannot load there,
 * so we must not hand such a binary to a musl runtime.
 */
export const isMuslLinux = () => {
  if (process.platform !== 'linux') return false;
  try {
    const header = process.report?.getReport?.()?.header;
    // Node reports the runtime glibc version; absent means musl.
    if (header && typeof header === 'object') {
      return !header.glibcVersionRuntime;
    }
  } catch {
    // fall through to filesystem probe
  }
  return fs.existsSync('/etc/alpine-release');
};

/** Directory name the runtime loader looks under: `<platform>-<arch>`. */
export const prebuildDir = () => `${process.platform}-${process.arch}`;

/**
 * Release-asset target. Same as {@link prebuildDir} plus a `-musl` suffix on
 * Alpine, so musl hosts miss cleanly instead of downloading a glibc binary
 * that cannot be loaded.
 */
export const assetTarget = () => `${prebuildDir()}${isMuslLinux() ? '-musl' : ''}`;

/**
 * Verify a compiled addon actually loads and works in this process.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export const verifyAddon = (file) => {
  try {
    const require = createRequire(import.meta.url);
    const mod = require(file);
    if (!mod || typeof mod.isAvailable !== 'function') {
      return { ok: false, reason: 'addon missing isAvailable()' };
    }
    if (!mod.isAvailable()) {
      return { ok: false, reason: 'isAvailable() returned false' };
    }
    if (typeof mod.compressSync === 'function' && typeof mod.decompressSync === 'function') {
      const probe = Buffer.from('openzl prebuild verification '.repeat(8));
      const back = mod.decompressSync(mod.compressSync(probe));
      if (!Buffer.isBuffer(back) || !back.equals(probe)) {
        return { ok: false, reason: 'roundtrip mismatch' };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};
