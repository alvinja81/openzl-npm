import type { ContentEncoding, PickEncodingOptions } from './types.js';
import { isZstdAvailable } from './zstd.js';
import { isBrotliAvailable } from './brotli.js';

/**
 * Parse an Accept-Encoding header into encoding name → q-value.
 * Encodings with q=0 are omitted (explicitly rejected).
 * Missing q defaults to 1.
 */
export const parseAcceptEncoding = (
  header: string | string[] | undefined | null
): Map<string, number> => {
  const value = Array.isArray(header) ? header.join(',') : header ?? '';
  const accepted = new Map<string, number>();

  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [rawName, ...params] = trimmed.split(';');
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;

    let q = 1;
    for (const param of params) {
      const p = param.trim();
      if (p.startsWith('q=')) {
        const parsed = parseFloat(p.slice(2));
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }

    if (q <= 0) continue;
    accepted.set(name, q);
  }

  return accepted;
};

/**
 * Choose a content encoding from Accept-Encoding (framework-free).
 *
 * Rules:
 * - `openzl` only when listed explicitly (never via `*`) — browsers stay safe
 * - `gzip` from explicit `gzip` or `*`
 * - `zstd` from explicit `zstd` (and optionally `*` if starMeansZstd)
 * - `br` from explicit `br` (and optionally `*` if starMeansBrotli)
 * - Higher q wins; ties fall back to openzl > zstd > br > gzip, subject to the
 *   prefer* flags (a codec whose flag is off loses every tie to gzip)
 * - Returns `identity` when nothing usable is accepted
 *
 * @example
 * ```ts
 * pickEncoding('openzl, zstd, gzip;q=0.8') // 'openzl' (if allowOpenZL)
 * pickEncoding('zstd, gzip')               // 'zstd' when runtime has zstd
 * pickEncoding('gzip, deflate, br')        // 'br'
 * pickEncoding('gzip')                     // 'gzip'
 * pickEncoding(undefined)                  // 'identity'
 * ```
 */
export const pickEncoding = (
  acceptEncoding: string | string[] | undefined | null,
  options: PickEncodingOptions = {}
): ContentEncoding => {
  const {
    preferOpenZL = true,
    preferZstd = true,
    preferBrotli = true,
    allowGzip = true,
    allowOpenZL = true,
    allowZstd = isZstdAvailable(),
    allowBrotli = isBrotliAvailable(),
    starMeansZstd = false,
    starMeansBrotli = false
  } = options;

  const accepted = parseAcceptEncoding(acceptEncoding);
  const star = accepted.get('*');

  /** q-value for one codec, folding in `*` only when that codec opts into it. */
  const qFor = (name: string, starCounts: boolean): number | undefined => {
    const explicit = accepted.get(name);
    if (!starCounts) return explicit;
    if (explicit !== undefined && star !== undefined) {
      return Math.max(explicit, star);
    }
    return explicit ?? star;
  };

  const openzlQ = allowOpenZL ? accepted.get('openzl') : undefined;
  const zstdQ = allowZstd ? qFor('zstd', starMeansZstd) : undefined;
  const brQ = allowBrotli ? qFor('br', starMeansBrotli) : undefined;
  const gzipQ = allowGzip ? qFor('gzip', true) : undefined;

  // Tie scores: higher wins when q is equal. A codec whose prefer* flag is off
  // drops below gzip, so gzip stays the conservative default.
  type Candidate = { encoding: ContentEncoding; q: number; tie: number };
  const candidates: Candidate[] = [];

  if (openzlQ !== undefined) {
    candidates.push({ encoding: 'openzl', q: openzlQ, tie: preferOpenZL ? 4 : 0 });
  }
  if (zstdQ !== undefined) {
    candidates.push({ encoding: 'zstd', q: zstdQ, tie: preferZstd ? 3 : 0 });
  }
  if (brQ !== undefined) {
    candidates.push({ encoding: 'br', q: brQ, tie: preferBrotli ? 2 : 0 });
  }
  if (gzipQ !== undefined) {
    candidates.push({ encoding: 'gzip', q: gzipQ, tie: 1 });
  }

  if (candidates.length === 0) {
    return 'identity';
  }

  candidates.sort((a, b) => b.q - a.q || b.tie - a.tie);
  return candidates[0]!.encoding;
};
