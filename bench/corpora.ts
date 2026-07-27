/**
 * Corpus generators for Phase 0.
 *
 * A — repetitive API JSON (REST list)
 * B — numeric time-series JSON (OpenZL home turf)
 * C — prose-heavy JSON (expect OpenZL serial to lose / tie)
 * D — compact JSON, short keys, few repeats
 * E — size sweep over a base shape
 * F — non-JSON binary, fixed-width records
 */

export type Corpus = {
  id: string;
  name: string;
  description: string;
  bytes: Buffer;
};

const TARGET = {
  '1kb': 1024,
  '10kb': 10 * 1024,
  '100kb': 100 * 1024,
  '1mb': 1024 * 1024,
  '10mb': 10 * 1024 * 1024
} as const;

export type SizeLabel = keyof typeof TARGET;

const jsonBytes = (value: unknown): Buffer =>
  Buffer.from(JSON.stringify(value), 'utf8');

/** Grow/shrink a JSON array payload toward a target byte length. */
const fitJsonArray = (
  makeItem: (i: number) => unknown,
  targetBytes: number,
  wrap: (items: unknown[]) => unknown
): Buffer => {
  const items: unknown[] = [];
  let buf = jsonBytes(wrap(items));
  let i = 0;
  // Grow until we meet or exceed target
  while (buf.length < targetBytes && i < 2_000_000) {
    items.push(makeItem(i++));
    buf = jsonBytes(wrap(items));
  }
  // If one item already overshoots (rare), still return it
  if (items.length === 0) {
    items.push(makeItem(0));
    buf = jsonBytes(wrap(items));
  }
  return buf;
};

/** A — repetitive API JSON (typical REST list endpoint). */
export const corpusA = (targetBytes = TARGET['100kb']): Corpus => {
  const statuses = ['active', 'pending', 'closed', 'archived'] as const;
  const roles = ['admin', 'user', 'viewer', 'editor'] as const;
  const bytes = fitJsonArray(
    (i) => ({
      id: `usr_${1000 + (i % 500)}`,
      email: `user${i % 200}@example.com`,
      name: `User ${i % 150}`,
      status: statuses[i % statuses.length],
      role: roles[i % roles.length],
      createdAt: new Date(1_700_000_000_000 + (i % 10_000) * 60_000).toISOString(),
      meta: {
        locale: i % 3 === 0 ? 'en-US' : i % 3 === 1 ? 'en-GB' : 'de-DE',
        verified: i % 4 !== 0,
        tags: ['api', 'customer', statuses[i % statuses.length]]
      }
    }),
    targetBytes,
    (data) => ({ ok: true, page: 1, pageSize: data.length, data })
  );
  return {
    id: 'A',
    name: 'api-list',
    description: 'Repetitive REST list JSON (shared keys, enum fields, emails)',
    bytes
  };
};

/** B — numeric time-series JSON. */
export const corpusB = (targetBytes = TARGET['100kb']): Corpus => {
  const bytes = fitJsonArray(
    (i) => ({
      t: 1_700_000_000 + i,
      sensor: `s${i % 8}`,
      temp: 20 + Math.sin(i / 17) * 5 + (i % 7) * 0.01,
      humidity: 40 + Math.cos(i / 23) * 10,
      pressure: 1013.25 + Math.sin(i / 41) * 2,
      battery: 100 - (i % 100) * 0.05
    }),
    targetBytes,
    (points) => ({
      series: 'env-v1',
      unit: { temp: 'C', humidity: '%', pressure: 'hPa', battery: '%' },
      points
    })
  );
  return {
    id: 'B',
    name: 'timeseries',
    description: 'Numeric time-series JSON (OpenZL home turf)',
    bytes
  };
};

const LOREM =
  'The quick brown fox jumps over the lazy dog. In distributed systems, ' +
  'partial failure is the norm rather than the exception. Operators learn to ' +
  'prefer boring technology when latency budgets shrink and error budgets burn. ';

/** C — prose-heavy JSON. */
export const corpusC = (targetBytes = TARGET['100kb']): Corpus => {
  const bytes = fitJsonArray(
    (i) => ({
      id: i,
      title: `Note ${i}: observations on reliability and compression tradeoffs`,
      body:
        LOREM.repeat(2 + (i % 3)) +
        ` Paragraph ${i}: unique token_${i}_${(i * 7919) % 9973} keeps entropy up.`
    }),
    targetBytes,
    (notes) => ({ type: 'journal', notes })
  );
  return {
    id: 'C',
    name: 'prose',
    description: 'Prose-heavy JSON (expect serial OpenZL to lose or tie)',
    bytes
  };
};

/** D — compact JSON, short keys, few structural repeats. */
export const corpusD = (targetBytes = TARGET['100kb']): Corpus => {
  const bytes = fitJsonArray(
    (i) => {
      // High uniqueness: little dictionary reuse
      const a = (i * 1103515245 + 12345) >>> 0;
      const b = (a * 1664525 + 1013904223) >>> 0;
      return {
        k: (a % 1_000_000).toString(36),
        v: (b % 1_000_000).toString(36),
        n: a % 10_000,
        f: (b % 10_000) / 100
      };
    },
    targetBytes,
    (rows) => rows
  );
  return {
    id: 'D',
    name: 'compact',
    description: 'Compact JSON, short keys, few repeats (harder dictionary wins)',
    bytes
  };
};

/** F — non-JSON binary, fixed-width records (16-byte records). */
export const corpusF = (targetBytes = TARGET['100kb']): Corpus => {
  const recordSize = 16;
  const count = Math.max(1, Math.floor(targetBytes / recordSize));
  const buf = Buffer.alloc(count * recordSize);
  for (let i = 0; i < count; i++) {
    const off = i * recordSize;
    buf.writeUInt32LE(i, off); // id
    buf.writeUInt32LE((i * 17) % 1_000_000, off + 4); // counter
    buf.writeFloatLE(20 + Math.sin(i / 13) * 5, off + 8); // value
    buf.writeUInt16LE(i % 8, off + 12); // sensor
    buf.writeUInt16LE(i % 4 === 0 ? 1 : 0, off + 14); // flag
  }
  return {
    id: 'F',
    name: 'binary-records',
    description: 'Non-JSON binary fixed-width records (16B each)',
    bytes: buf
  };
};

/** E — size sweep: same shape (API list) at multiple sizes. */
export const corpusE = (size: SizeLabel): Corpus => {
  const target = TARGET[size];
  const base = corpusA(target);
  return {
    id: `E-${size}`,
    name: `size-${size}`,
    description: `Size sweep (${size}) using API-list shape`,
    bytes: base.bytes
  };
};

export const SIZE_LABELS: SizeLabel[] = ['1kb', '10kb', '100kb', '1mb', '10mb'];

/** Default Phase 0 matrix: A–D + F at ~100KB, plus E size sweep. */
export const buildDefaultCorpora = (opts: { full?: boolean } = {}): Corpus[] => {
  const sizes: SizeLabel[] = opts.full
    ? SIZE_LABELS
    : ['1kb', '10kb', '100kb', '1mb']; // 10mb opt-in via --full

  return [
    corpusA(TARGET['100kb']),
    corpusB(TARGET['100kb']),
    corpusC(TARGET['100kb']),
    corpusD(TARGET['100kb']),
    ...sizes.map(corpusE),
    corpusF(TARGET['100kb'])
  ];
};
