/**
 * Compare a trained (or shipped) OpenZL profile against gzip / br / zstd
 * on a held-out buffer. Used by `openzl-train` and tests.
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(zlib.gzip);
const brotliAsync =
  typeof zlib.brotliCompress === 'function' ? promisify(zlib.brotliCompress) : null;
const zstdAsync = typeof zlib.zstdCompress === 'function' ? promisify(zlib.zstdCompress) : null;

const BROTLI_QUALITY = 4;

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

const loadCompress = async () => {
  try {
    return await import(path.join(pkgRoot, 'dist/core-entry.js'));
  } catch {
    try {
      return require(path.join(pkgRoot, 'dist/cjs/core-entry.js'));
    } catch {
      return null;
    }
  }
};

const pct = (out, plain) => +((out / plain) * 100).toFixed(2);

/**
 * @param {Buffer} plain
 * @param {{ profile?: string }} [opts]
 * @returns {Promise<{
 *   plainBytes: number,
 *   codecs: Record<string, { bytes: number, ratioPct: number, encodeMs: number } | { available: false, error?: string }>,
 *   bestHero: string | null,
 *   verdict: 'enable' | 'keep-heroes' | 'tie' | 'openzl-unavailable',
 *   reason: string
 * }>}
 */
export async function compareHeldOut(plain, opts = {}) {
  const started = (fn) => {
    const t0 = performance.now();
    return Promise.resolve(fn()).then((buf) => ({
      buf,
      ms: performance.now() - t0
    }));
  };

  const codecs = {};

  {
    const { buf, ms } = await started(() => gzipAsync(plain));
    codecs.gzip = { bytes: buf.length, ratioPct: pct(buf.length, plain.length), encodeMs: +ms.toFixed(3) };
  }

  if (brotliAsync) {
    const params = zlib.constants?.BROTLI_PARAM_QUALITY != null
      ? { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }
      : undefined;
    const { buf, ms } = await started(() => brotliAsync(plain, params));
    codecs.br = { bytes: buf.length, ratioPct: pct(buf.length, plain.length), encodeMs: +ms.toFixed(3) };
  } else {
    codecs.br = { available: false };
  }

  if (zstdAsync) {
    const { buf, ms } = await started(() => zstdAsync(plain));
    codecs.zstd = { bytes: buf.length, ratioPct: pct(buf.length, plain.length), encodeMs: +ms.toFixed(3) };
  } else {
    codecs.zstd = { available: false };
  }

  const core = await loadCompress();
  if (!core?.compress) {
    codecs.openzl = { available: false, error: 'openzl-express dist not built' };
  } else {
    try {
      const { buf, ms } = await started(() =>
        core.compress(plain, opts.profile ? { profile: opts.profile } : undefined)
      );
      codecs.openzl = {
        bytes: buf.length,
        ratioPct: pct(buf.length, plain.length),
        encodeMs: +ms.toFixed(3)
      };
    } catch (err) {
      codecs.openzl = {
        available: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  const heroNames = ['gzip', 'br', 'zstd'].filter((n) => codecs[n] && codecs[n].bytes != null);
  let bestHero = null;
  let bestHeroBytes = Infinity;
  for (const n of heroNames) {
    if (codecs[n].bytes < bestHeroBytes) {
      bestHeroBytes = codecs[n].bytes;
      bestHero = n;
    }
  }

  const oz = codecs.openzl;
  let verdict;
  let reason;
  if (oz.bytes == null) {
    verdict = 'openzl-unavailable';
    reason = `OpenZL encode failed (${oz.error ?? 'unavailable'}). Keep ${bestHero ?? 'gzip'}.`;
  } else if (bestHero == null) {
    verdict = 'enable';
    reason = 'No hero codec available; OpenZL is the only compressor.';
  } else if (oz.bytes < bestHeroBytes) {
    verdict = 'enable';
    reason = `OpenZL is smaller than ${bestHero} (${oz.bytes} < ${bestHeroBytes} bytes). Enable on this shape.`;
  } else if (oz.bytes === bestHeroBytes) {
    verdict = 'tie';
    reason = `OpenZL ties ${bestHero} at ${oz.bytes} bytes. Keep the hero — simpler clients.`;
  } else {
    verdict = 'keep-heroes';
    reason = `OpenZL lost to ${bestHero} (${oz.bytes} > ${bestHeroBytes} bytes). Do not enable OpenZL for this shape.`;
  }

  return {
    plainBytes: plain.length,
    codecs,
    bestHero,
    verdict,
    reason
  };
}

export const formatCompareTable = (result, { heldOut } = {}) => {
  const lines = [];
  if (heldOut) lines.push(`held-out: ${heldOut} (${result.plainBytes} bytes)`);
  else lines.push(`plain: ${result.plainBytes} bytes`);
  const order = ['gzip', 'br', 'zstd', 'openzl'];
  const namePad = 8;
  for (const name of order) {
    const c = result.codecs[name];
    if (!c) continue;
    if (c.bytes == null) {
      lines.push(`  ${name.padEnd(namePad)} n/a${c.error ? `  (${c.error})` : ''}`);
    } else {
      const mark =
        name === 'openzl' && result.verdict === 'enable'
          ? '  WIN'
          : name === result.bestHero
            ? '  best hero'
            : '';
      lines.push(
        `  ${name.padEnd(namePad)} ${String(c.bytes).padStart(8)}  ${String(c.ratioPct).padStart(6)}%  ${c.encodeMs} ms${mark}`
      );
    }
  }
  lines.push(`verdict: ${result.verdict}`);
  lines.push(result.reason);
  return lines.join('\n');
};
