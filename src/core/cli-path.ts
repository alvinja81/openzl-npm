/**
 * Resolve the *native* zli binary — not the Node launcher script.
 *
 * `node_modules/.bin/zli` is a Node wrapper that `spawnSync`s the real binary.
 * Going through it costs ~25ms of Node startup per request. The raw binary
 * is in the ~1–3ms class that Phase 1 targets.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { OpenZLCLINotFoundError } from './errors.js';

const execFileAsync = promisify(execFile);

const isWindows = process.platform === 'win32';
const platformKey = `${process.platform}-${process.arch}`;
const binaryName = isWindows ? 'zli.exe' : 'zli';

/** Relative candidates from process.cwd() for the raw platform binary. */
const RAW_RELATIVE = [
  path.join('node_modules', '@amirja811', 'openzl-cli', 'build', 'binaries', platformKey, binaryName),
  path.join('node_modules', 'openzl-cli', 'build', 'binaries', platformKey, binaryName),
  path.join('@openzl-cli', 'build', 'binaries', platformKey, binaryName),
  path.join('openzl', 'build', 'cli', binaryName),
  path.join('openzl', 'build', 'binaries', platformKey, binaryName)
];

/** Launcher scripts — used only to derive the raw binary path beside them. */
const LAUNCHER_RELATIVE = [
  path.join('node_modules', '.bin', isWindows ? 'zli.cmd' : 'zli'),
  path.join('node_modules', '@amirja811', 'openzl-cli', 'bin', 'zli'),
  path.join('node_modules', 'openzl-cli', 'bin', 'zli')
];

const isExecutableFile = async (filePath: string): Promise<boolean> => {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) return false;
    if (isWindows) return true;
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * True if path looks like a Node launcher script (shebang + "zli launcher"),
 * not the native Mach-O/ELF/PE binary.
 */
const isNodeLauncher = async (filePath: string): Promise<boolean> => {
  try {
    const fh = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(80);
      const { bytesRead } = await fh.read(buf, 0, 80, 0);
      const head = buf.subarray(0, bytesRead).toString('utf8');
      if (head.startsWith('#!') && /node/i.test(head)) return true;
      // PE/Mach-O/ELF magic → native
      if (buf[0] === 0x7f && buf[1] === 0x45) return false; // ELF
      if (buf[0] === 0x4d && buf[1] === 0x5a) return false; // PE
      if (buf[0] === 0xcf && buf[1] === 0xfa) return false; // Mach-O
      if (buf[0] === 0xca && buf[1] === 0xfe) return false; // Mach-O fat
      if (buf[0] === 0xfe && buf[1] === 0xed) return false; // Mach-O
      return /zli launcher|Locates the platform-specific/i.test(head);
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
};

/** If `candidate` is a launcher, return sibling raw binary path; else null. */
const rawBesideLauncher = async (launcherPath: string): Promise<string | null> => {
  // bin/zli → ../build/binaries/<platform>/zli
  const beside = path.join(
    path.dirname(launcherPath),
    '..',
    'build',
    'binaries',
    platformKey,
    binaryName
  );
  if (await isExecutableFile(beside)) return path.resolve(beside);

  // node_modules/.bin/zli is often a symlink into bin/ — resolve realpath first
  try {
    const real = await fs.realpath(launcherPath);
    if (real !== launcherPath) {
      const fromReal = path.join(
        path.dirname(real),
        '..',
        'build',
        'binaries',
        platformKey,
        binaryName
      );
      if (await isExecutableFile(fromReal)) return path.resolve(fromReal);
    }
  } catch {
    // ignore
  }
  return null;
};

/**
 * Verify a candidate actually runs and is not a placeholder stub.
 */
export const isRealZli = async (cliPath: string): Promise<boolean> => {
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, ['--version'], {
      timeout: 5000
    });
    const output = `${stdout}${stderr}`;
    return !/binary not available|placeholder|no OpenZL binary/i.test(output);
  } catch {
    return false;
  }
};

let cachedZliPath: string | null | undefined;
let zliLookup: Promise<string | null> | undefined;

const discoverZliPath = async (): Promise<string | null> => {
  const cwd = process.cwd();
  const tried = new Set<string>();

  const consider = async (candidate: string): Promise<string | null> => {
    const abs = path.resolve(candidate);
    if (tried.has(abs)) return null;
    tried.add(abs);
    if (!(await isExecutableFile(abs))) return null;

    // Prefer raw binary over Node launcher
    if (await isNodeLauncher(abs)) {
      const raw = await rawBesideLauncher(abs);
      if (raw && (await isRealZli(raw))) return raw;
      return null;
    }

    if (await isRealZli(abs)) return abs;
    return null;
  };

  for (const rel of RAW_RELATIVE) {
    const hit = await consider(path.join(cwd, rel));
    if (hit) return hit;
  }

  for (const rel of LAUNCHER_RELATIVE) {
    const hit = await consider(path.join(cwd, rel));
    if (hit) return hit;
  }

  // PATH lookup (may be launcher or raw)
  try {
    const whichCmd = isWindows ? 'where' : 'which';
    const { stdout } = await execFileAsync(whichCmd, ['zli'], { timeout: 3000 });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first) {
      const hit = await consider(first);
      if (hit) return hit;
    }
  } catch {
    // not on PATH
  }

  // Bare name as last resort (inherits PATH at spawn time)
  if (await isRealZli(binaryName)) {
    // Could still be launcher on PATH via shell — try which already covered it
    return binaryName;
  }

  return null;
};

/**
 * Absolute path to the native zli binary.
 * @throws {OpenZLCLINotFoundError}
 */
export const findZliPath = async (): Promise<string> => {
  if (cachedZliPath !== undefined) {
    if (cachedZliPath === null) throw new OpenZLCLINotFoundError();
    return cachedZliPath;
  }

  if (!zliLookup) {
    zliLookup = discoverZliPath();
  }

  cachedZliPath = await zliLookup;
  if (cachedZliPath === null) throw new OpenZLCLINotFoundError();
  return cachedZliPath;
};

export const resetCLICache = (): void => {
  cachedZliPath = undefined;
  zliLookup = undefined;
};

export const checkCLIAvailable = async (): Promise<boolean> => {
  try {
    await findZliPath();
    return true;
  } catch {
    return false;
  }
};

/**
 * True if OpenZL can compress in this process: native addon and/or zli CLI.
 * Prefer {@link checkOpenZLAvailable} for new code.
 */
export const checkOpenZLAvailable = async (): Promise<boolean> => {
  // Lazy import to avoid circular deps with native.ts consumers
  try {
    const { isNativeAvailable } = await import('./native.js');
    if (isNativeAvailable()) return true;
  } catch {
    // ignore
  }
  return checkCLIAvailable();
};

export const platformBinaryName = binaryName;
export const platformBinaryKey = platformKey;
