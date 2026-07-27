/**
 * Profile resolution for OpenZL compressors.
 *
 * - builtin: CLI `-p <name>` (serial, le-u32, …)
 * - trained: CLI `-c <file.zlc>` (shipped under profiles/)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type ProfileKind = 'builtin' | 'trained';

export type ResolvedProfile = {
  /** Logical name used by the app (serial, timeseries, …) */
  name: string;
  kind: ProfileKind;
  /** CLI -p value when kind=builtin */
  cliProfile?: string;
  /** Absolute path to .zlc when kind=trained */
  compressorPath?: string;
  description?: string;
};

type ManifestProfile =
  | {
      type: 'builtin';
      profile: string;
      description?: string;
    }
  | {
      type: 'trained';
      file: string;
      baseProfile?: string;
      description?: string;
      recommendedFor?: string[];
    };

type Manifest = {
  version: number;
  default: string;
  profiles: Record<string, ManifestProfile>;
};

const here = path.dirname(fileURLToPath(import.meta.url));

/** Candidate roots for the profiles/ directory. */
const profileRoots = (): string[] => {
  const roots = [
    path.resolve(here, '../../profiles'),
    path.resolve(process.cwd(), 'profiles'),
    // When installed as a package, assets may sit next to package root
    path.resolve(here, '../../../profiles')
  ];
  return [...new Set(roots)];
};

let cachedManifest: Manifest | null | undefined;
let cachedRoot: string | null | undefined;

const loadManifest = (): { manifest: Manifest; root: string } | null => {
  if (cachedManifest && cachedRoot) {
    return { manifest: cachedManifest, root: cachedRoot };
  }
  for (const root of profileRoots()) {
    const mp = path.join(root, 'manifest.json');
    if (!fs.existsSync(mp)) continue;
    try {
      const raw = fs.readFileSync(mp, 'utf8');
      const manifest = JSON.parse(raw) as Manifest;
      cachedManifest = manifest;
      cachedRoot = root;
      return { manifest, root };
    } catch {
      // try next root
    }
  }
  return null;
};

/** Reset profile cache (tests). */
export const resetProfileCache = (): void => {
  cachedManifest = undefined;
  cachedRoot = undefined;
};

/** List known profile names from the shipped manifest (+ serial fallback). */
export const listProfiles = (): string[] => {
  const loaded = loadManifest();
  if (!loaded) return ['serial'];
  return Object.keys(loaded.manifest.profiles);
};

/**
 * Resolve a profile name or explicit compressor path into CLI arguments.
 *
 * @param nameOrPath Profile key from manifest, builtin name, or absolute/relative .zlc path
 */
export const resolveProfile = (nameOrPath: string = 'serial'): ResolvedProfile => {
  // Explicit compressor file
  if (nameOrPath.endsWith('.zlc') || nameOrPath.endsWith('.zlcomp')) {
    const abs = path.isAbsolute(nameOrPath)
      ? nameOrPath
      : path.resolve(process.cwd(), nameOrPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`Compressor file not found: ${abs}`);
    }
    return {
      name: path.basename(nameOrPath, path.extname(nameOrPath)),
      kind: 'trained',
      compressorPath: abs
    };
  }

  const loaded = loadManifest();
  if (loaded) {
    const entry = loaded.manifest.profiles[nameOrPath];
    if (entry) {
      if (entry.type === 'builtin') {
        return {
          name: nameOrPath,
          kind: 'builtin',
          cliProfile: entry.profile,
          description: entry.description
        };
      }
      const file = path.join(loaded.root, entry.file);
      if (!fs.existsSync(file)) {
        throw new Error(
          `Trained profile "${nameOrPath}" missing file ${file}. Run npm run train:profiles`
        );
      }
      return {
        name: nameOrPath,
        kind: 'trained',
        compressorPath: file,
        description: entry.description
      };
    }
  }

  // Unknown name → treat as builtin CLI profile (serial, le-u32, csv, …)
  return {
    name: nameOrPath,
    kind: 'builtin',
    cliProfile: nameOrPath
  };
};

/**
 * Default profile for a rough content-shape hint (not ML — just heuristics).
 */
export const suggestProfile = (
  shape: 'json-api' | 'json-timeseries' | 'json-prose' | 'binary' | 'unknown'
): string => {
  switch (shape) {
    case 'json-api':
      return 'api-list';
    case 'json-timeseries':
      return 'timeseries';
    case 'json-prose':
      return 'prose';
    case 'binary':
      return 'binary';
    default:
      return 'serial';
  }
};

/** Absolute path to the profiles directory if found. */
export const getProfilesRoot = (): string | null => loadManifest()?.root ?? null;
