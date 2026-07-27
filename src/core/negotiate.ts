import type { ContentEncoding, PickEncodingOptions } from './types.js';

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
 * Rules (gzip-like negotiation):
 * - `openzl` is only chosen when the client lists it explicitly (never via `*`)
 * - `*` counts as gzip support, not openzl
 * - Higher q-value wins; ties break toward openzl when preferOpenZL is true
 * - Returns `identity` when nothing usable is accepted
 *
 * @example
 * ```ts
 * pickEncoding('openzl, gzip;q=0.8') // 'openzl'
 * pickEncoding('gzip')               // 'gzip'
 * pickEncoding(undefined)            // 'identity'
 * ```
 */
export const pickEncoding = (
  acceptEncoding: string | string[] | undefined | null,
  options: PickEncodingOptions = {}
): ContentEncoding => {
  const {
    preferOpenZL = true,
    allowGzip = true,
    allowOpenZL = true
  } = options;

  const accepted = parseAcceptEncoding(acceptEncoding);

  const openzlQ = allowOpenZL ? accepted.get('openzl') : undefined;

  let gzipQ: number | undefined;
  if (allowGzip) {
    const explicit = accepted.get('gzip');
    const star = accepted.get('*');
    if (explicit !== undefined && star !== undefined) {
      gzipQ = Math.max(explicit, star);
    } else {
      gzipQ = explicit ?? star;
    }
  }

  type Candidate = { encoding: ContentEncoding; q: number; tie: number };
  const candidates: Candidate[] = [];

  if (openzlQ !== undefined) {
    candidates.push({
      encoding: 'openzl',
      q: openzlQ,
      tie: preferOpenZL ? 2 : 0
    });
  }
  if (gzipQ !== undefined) {
    candidates.push({
      encoding: 'gzip',
      q: gzipQ,
      tie: preferOpenZL ? 1 : 2
    });
  }

  if (candidates.length === 0) {
    return 'identity';
  }

  candidates.sort((a, b) => b.q - a.q || b.tie - a.tie);
  return candidates[0]!.encoding;
};
