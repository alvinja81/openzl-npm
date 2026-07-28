/**
 * Codec runners: gzip / brotli / zstd / openzl (serial + trained profiles).
 */

import {
  gzipSync,
  gunzipSync,
  brotliCompressSync,
  brotliDecompressSync,
  zstdCompressSync,
  zstdDecompressSync,
  constants
} from 'zlib';
import {
  compress as openzlCompress,
  decompress as openzlDecompress,
  checkCLIAvailable,
  isNativeAvailable,
  resolveProfile
} from '../dist/core/engine.js';

export type CodecId =
  | 'gzip-1'
  | 'gzip-6'
  | 'gzip-9'
  | 'brotli-4'
  | 'brotli-11'
  | 'zstd-1'
  | 'zstd-3'
  | 'zstd-19'
  | 'openzl-serial'
  | 'openzl-timeseries'
  | 'openzl-api-list'
  | 'openzl-prose'
  | 'openzl-binary'
  | 'openzl-binary-le-u32'
  | 'openzl-binary-sddl';

export type Codec = {
  id: CodecId;
  name: string;
  family: 'gzip' | 'brotli' | 'zstd' | 'openzl';
  compressSync?: (input: Buffer) => Buffer;
  decompressSync?: (input: Buffer) => Buffer;
  compressAsync?: (input: Buffer) => Promise<Buffer>;
  decompressAsync?: (input: Buffer) => Promise<Buffer>;
  asyncOnly?: boolean;
  /** Optional: only meaningful on matching corpora */
  bestFor?: string[];
};

const gzip = (level: number): Pick<Codec, 'compressSync' | 'decompressSync'> => ({
  compressSync: (input) => gzipSync(input, { level }),
  decompressSync: (input) => gunzipSync(input)
});

const brotli = (quality: number): Pick<Codec, 'compressSync' | 'decompressSync'> => ({
  compressSync: (input) =>
    brotliCompressSync(input, {
      params: { [constants.BROTLI_PARAM_QUALITY]: quality }
    }),
  decompressSync: (input) => brotliDecompressSync(input)
});

const zstd = (level: number): Pick<Codec, 'compressSync' | 'decompressSync'> => ({
  compressSync: (input) =>
    zstdCompressSync(input, {
      params: { [constants.ZSTD_c_compressionLevel]: level }
    }),
  decompressSync: (input) => zstdDecompressSync(input)
});

const openzlProfile = (
  id: CodecId,
  name: string,
  profile: string,
  bestFor?: string[]
): Codec => ({
  id,
  name,
  family: 'openzl',
  asyncOnly: true,
  bestFor,
  compressAsync: (input) => openzlCompress(input, { profile }),
  decompressAsync: openzlDecompress
});

export const CODECS: Codec[] = [
  { id: 'gzip-1', name: 'gzip L1', family: 'gzip', ...gzip(1) },
  { id: 'gzip-6', name: 'gzip L6', family: 'gzip', ...gzip(6) },
  { id: 'gzip-9', name: 'gzip L9', family: 'gzip', ...gzip(9) },
  { id: 'brotli-4', name: 'brotli L4', family: 'brotli', ...brotli(4) },
  { id: 'brotli-11', name: 'brotli L11', family: 'brotli', ...brotli(11) },
  { id: 'zstd-1', name: 'zstd L1', family: 'zstd', ...zstd(1) },
  { id: 'zstd-3', name: 'zstd L3', family: 'zstd', ...zstd(3) },
  { id: 'zstd-19', name: 'zstd L19', family: 'zstd', ...zstd(19) },
  openzlProfile('openzl-serial', 'openzl serial', 'serial'),
  openzlProfile('openzl-timeseries', 'openzl timeseries', 'timeseries', ['B', 'timeseries']),
  openzlProfile('openzl-api-list', 'openzl api-list', 'api-list', ['A', 'api-list', 'E-']),
  openzlProfile('openzl-prose', 'openzl prose', 'prose', ['C', 'prose']),
  openzlProfile('openzl-binary', 'openzl binary', 'binary', ['F', 'binary']),
  openzlProfile('openzl-binary-le-u32', 'openzl binary le-u32', 'binary-le-u32', ['F', 'binary']),
  openzlProfile('openzl-binary-sddl', 'openzl binary sddl', 'binary-sddl', ['F', 'binary'])
];

export const isZstdAvailable = (): boolean => {
  try {
    const round = zstdDecompressSync(zstdCompressSync(Buffer.from('ping')));
    return round.toString() === 'ping';
  } catch {
    return false;
  }
};

const trainedAvailable = (name: string): boolean => {
  try {
    const r = resolveProfile(name);
    return r.kind === 'trained' && !!r.compressorPath;
  } catch {
    return false;
  }
};

export const resolveCodecs = async (): Promise<{
  codecs: Codec[];
  openzlAvailable: boolean;
  zstdAvailable: boolean;
  notes: string[];
}> => {
  const notes: string[] = [];
  const zstdAvailable = isZstdAvailable();
  if (!zstdAvailable) {
    notes.push('zstd unavailable in this Node build — zstd runners skipped');
  }

  const cliOk = await checkCLIAvailable();
  const nativeOk = isNativeAvailable();
  const openzlAvailable = cliOk || nativeOk;
  if (!openzlAvailable) {
    notes.push('neither native addon nor zli CLI available — openzl runners skipped');
  } else if (!cliOk && nativeOk) {
    notes.push('CLI unavailable — trained profiles need zli; only openzl-serial (native) will run');
  }

  const codecs = CODECS.filter((c) => {
    if (c.family === 'zstd' && !zstdAvailable) return false;
    if (c.family !== 'openzl') return true;
    if (!openzlAvailable) return false;
    if (c.id === 'openzl-serial') return true;
    // Trained profiles need CLI + .zlc file
    if (!cliOk) return false;
    const profileName = c.id.replace('openzl-', '');
    if (!trainedAvailable(profileName)) {
      notes.push(`trained profile "${profileName}" missing — skip ${c.id}`);
      return false;
    }
    return true;
  });

  return { codecs, openzlAvailable, zstdAvailable, notes };
};
