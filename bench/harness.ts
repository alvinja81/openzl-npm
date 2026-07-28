import { performance } from 'node:perf_hooks';
import type { Codec } from './codecs.ts';
import type { Corpus } from './corpora.ts';
import { summarize, type Percentiles } from './stats.ts';

export type BenchConfig = {
  warmup: number;
  iterations: number;
  trimOutliers: boolean;
};

export type RowResult = {
  corpusId: string;
  corpusName: string;
  originalBytes: number;
  codecId: string;
  codecName: string;
  compressedBytes: number;
  ratio: number;
  encode: Percentiles;
  decode: Percentiles;
  /** Wall ms for a single verified round-trip (last timed iter). */
  encodeCpuHintMs: number;
  decodeCpuHintMs: number;
  rssDeltaBytes: number;
  error?: string;
};

const nowMs = (): number => performance.now();

const rss = (): number => process.memoryUsage().rss;

const iterationBudget = (originalBytes: number, base: number): { warmup: number; iterations: number } => {
  if (originalBytes >= 8 * 1024 * 1024) {
    return { warmup: 1, iterations: Math.max(3, Math.min(base, 5)) };
  }
  if (originalBytes >= 512 * 1024) {
    return { warmup: 2, iterations: Math.max(7, Math.min(base, 11)) };
  }
  return { warmup: Math.min(5, base), iterations: base };
};

async function runCodecOnce(
  codec: Codec,
  mode: 'compress' | 'decompress',
  payload: Buffer
): Promise<Buffer> {
  if (codec.asyncOnly) {
    if (mode === 'compress') return codec.compressAsync!(payload);
    return codec.decompressAsync!(payload);
  }
  if (mode === 'compress') return codec.compressSync!(payload);
  return codec.decompressSync!(payload);
}

export async function benchPair(
  corpus: Corpus,
  codec: Codec,
  config: BenchConfig
): Promise<RowResult> {
  const budget = iterationBudget(corpus.bytes.length, config.iterations);
  const warmup = Math.min(config.warmup, budget.warmup);
  const iterations = budget.iterations;

  const base: RowResult = {
    corpusId: corpus.id,
    corpusName: corpus.name,
    originalBytes: corpus.bytes.length,
    codecId: codec.id,
    codecName: codec.name,
    compressedBytes: 0,
    ratio: 0,
    encode: summarize([]),
    decode: summarize([]),
    encodeCpuHintMs: 0,
    decodeCpuHintMs: 0,
    rssDeltaBytes: 0
  };

  try {
    // Correctness + compressed size from a single compress
    const compressed = await runCodecOnce(codec, 'compress', corpus.bytes);
    const roundtrip = await runCodecOnce(codec, 'decompress', compressed);
    if (!roundtrip.equals(corpus.bytes)) {
      return { ...base, error: 'round-trip mismatch' };
    }

    base.compressedBytes = compressed.length;
    base.ratio = compressed.length / corpus.bytes.length;

    // Warmup (untimed)
    for (let i = 0; i < warmup; i++) {
      const c = await runCodecOnce(codec, 'compress', corpus.bytes);
      await runCodecOnce(codec, 'decompress', c);
    }

    if (typeof global.gc === 'function') {
      global.gc();
    }

    const rssBefore = rss();
    const encodeSamples: number[] = [];
    const decodeSamples: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const t0 = nowMs();
      const c = await runCodecOnce(codec, 'compress', corpus.bytes);
      const t1 = nowMs();
      await runCodecOnce(codec, 'decompress', c);
      const t2 = nowMs();
      encodeSamples.push(t1 - t0);
      decodeSamples.push(t2 - t1);
    }

    const rssAfter = rss();

    return {
      ...base,
      encode: summarize(encodeSamples, config.trimOutliers),
      decode: summarize(decodeSamples, config.trimOutliers),
      encodeCpuHintMs: encodeSamples[encodeSamples.length - 1] ?? 0,
      decodeCpuHintMs: decodeSamples[decodeSamples.length - 1] ?? 0,
      rssDeltaBytes: Math.max(0, rssAfter - rssBefore)
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function runMatrix(
  corpora: Corpus[],
  codecs: Codec[],
  config: BenchConfig,
  onProgress?: (msg: string) => void
): Promise<RowResult[]> {
  const rows: RowResult[] = [];
  const total = corpora.length * codecs.length;
  let done = 0;

  for (const corpus of corpora) {
    for (const codec of codecs) {
      done++;
      // Shape-specific trained codecs only run on matching corpora
      // (e.g. le-u32 rejects unaligned JSON — an error row would be noise).
      if (
        codec.bestFor &&
        !codec.bestFor.some(
          (tag) => corpus.id.startsWith(tag) || corpus.name.includes(tag)
        )
      ) {
        continue;
      }
      onProgress?.(
        `[${done}/${total}] ${corpus.id}/${corpus.name} × ${codec.id} (${corpus.bytes.length} bytes)`
      );
      rows.push(await benchPair(corpus, codec, config));
    }
  }
  return rows;
}
