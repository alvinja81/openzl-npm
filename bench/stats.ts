/** Percentiles + outlier trimming for honest latency numbers. */

export type Percentiles = {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
  n: number;
  nRaw: number;
};

/**
 * Trim mild outliers with IQR fences (Tukey), then compute percentiles.
 * Keeps the distribution honest without hiding real p99 tail on small N.
 */
export const summarize = (samplesMs: number[], trimOutliers = true): Percentiles => {
  const nRaw = samplesMs.length;
  if (nRaw === 0) {
    return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0, n: 0, nRaw: 0 };
  }

  const sorted = [...samplesMs].sort((a, b) => a - b);
  let working = sorted;

  if (trimOutliers && sorted.length >= 8) {
    const q1 = percentile(sorted, 25);
    const q3 = percentile(sorted, 75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const trimmed = sorted.filter((v) => v >= lo && v <= hi);
    // Never drop more than ~25% — protects small-N runs
    if (trimmed.length >= Math.ceil(sorted.length * 0.75)) {
      working = trimmed;
    }
  }

  const mean = working.reduce((a, b) => a + b, 0) / working.length;
  return {
    p50: percentile(working, 50),
    p95: percentile(working, 95),
    p99: percentile(working, 99),
    mean,
    min: working[0]!,
    max: working[working.length - 1]!,
    n: working.length,
    nRaw
  };
};

/** Nearest-rank percentile on a pre-sorted array. */
export const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const w = rank - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
};

export const formatMs = (ms: number): string => {
  if (ms < 0.01) return `${(ms * 1000).toFixed(1)}µs`;
  if (ms < 1) return `${ms.toFixed(3)}ms`;
  if (ms < 100) return `${ms.toFixed(2)}ms`;
  return `${ms.toFixed(1)}ms`;
};

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
};

export const formatRatio = (compressed: number, original: number): string => {
  if (original === 0) return 'n/a';
  const pct = (compressed / original) * 100;
  return `${pct.toFixed(1)}%`;
};
