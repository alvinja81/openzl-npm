/**
 * Phase 0 benchmark entrypoint.
 *
 *   npm run bench
 *   npm run bench -- --full          # include 10MB size sweep
 *   npm run bench -- --iterations 21
 *   npm run bench -- --quick         # fewer iters, skip 1mb+
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDefaultCorpora, corpusA, corpusB, corpusC, corpusD, corpusE, corpusF } from './corpora.ts';
import { resolveCodecs } from './codecs.ts';
import { runMatrix, type BenchConfig } from './harness.ts';
import { simulateHttp } from './http-sim.ts';
import { buildMarkdownReport, rowsToJson, type ReportMeta } from './report.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(__dirname, 'results');

const parseArgs = (argv: string[]) => {
  const full = argv.includes('--full');
  const quick = argv.includes('--quick');
  const iterIdx = argv.indexOf('--iterations');
  const iterations = iterIdx >= 0 ? Number(argv[iterIdx + 1]) : quick ? 9 : 31;
  const warmupIdx = argv.indexOf('--warmup');
  const warmup = warmupIdx >= 0 ? Number(argv[warmupIdx + 1]) : quick ? 2 : 5;
  return {
    full,
    quick,
    iterations: Number.isFinite(iterations) && iterations > 0 ? iterations : 31,
    warmup: Number.isFinite(warmup) && warmup >= 0 ? warmup : 5
  };
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config: BenchConfig = {
    warmup: args.warmup,
    iterations: args.iterations,
    trimOutliers: true
  };

  console.log('Phase 0 — baseline harness');
  console.log(`  Node ${process.version} · ${process.platform}/${process.arch}`);
  console.log(`  warmup=${config.warmup} iterations=${config.iterations} full=${args.full} quick=${args.quick}`);

  // Ensure library is built (engine import from dist)
  try {
    await import('../dist/core/engine.js');
  } catch {
    console.error('dist/ not built. Run: npm run build');
    process.exit(1);
  }

  const { codecs, notes, openzlAvailable, zstdAvailable } = await resolveCodecs();
  console.log(`  codecs: ${codecs.map((c) => c.id).join(', ')}`);
  console.log(`  openzl: ${openzlAvailable ? 'yes' : 'NO'} · zstd: ${zstdAvailable ? 'yes' : 'NO'}`);
  for (const n of notes) console.warn(`  note: ${n}`);

  let corpora = buildDefaultCorpora({ full: args.full });
  if (args.quick) {
    corpora = [
      corpusA(10 * 1024),
      corpusB(10 * 1024),
      corpusC(10 * 1024),
      corpusD(10 * 1024),
      corpusE('1kb'),
      corpusE('10kb'),
      corpusF(10 * 1024)
    ];
  }

  console.log('Corpora:');
  for (const c of corpora) {
    console.log(`  ${c.id.padEnd(8)} ${String(c.bytes.length).padStart(10)} B  ${c.name}`);
  }

  const rows = await runMatrix(corpora, codecs, config, (msg) => console.log(`  ${msg}`));
  const http = simulateHttp(rows);

  const meta: ReportMeta = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    notes,
    warmup: config.warmup,
    iterations: config.iterations
  };

  await fs.mkdir(resultsDir, { recursive: true });
  const md = buildMarkdownReport(meta, corpora, rows, http);
  const json = rowsToJson(meta, corpora, rows, http);

  const mdPath = path.join(resultsDir, 'baseline.md');
  const jsonPath = path.join(resultsDir, 'baseline.json');
  await fs.writeFile(mdPath, md, 'utf8');
  await fs.writeFile(jsonPath, json, 'utf8');

  const failed = rows.filter((r) => r.error);
  console.log('');
  console.log(`Wrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Rows: ${rows.length} · errors: ${failed.length}`);
  if (failed.length) {
    for (const f of failed) {
      console.warn(`  FAIL ${f.corpusId} × ${f.codecId}: ${f.error}`);
    }
  }

  // Quick console summary: openzl vs zstd-3 on 100kb-class corpora
  console.log('');
  console.log('Snapshot — encode p50 / ratio (openzl serial vs zstd L3):');
  for (const c of corpora.filter((x) => ['A', 'B', 'C', 'D', 'F'].includes(x.id) || x.id === 'E-100kb')) {
    const oz = rows.find((r) => r.corpusId === c.id && r.codecId === 'openzl-serial' && !r.error);
    const zs = rows.find((r) => r.corpusId === c.id && r.codecId === 'zstd-3' && !r.error);
    if (!oz || !zs) continue;
    console.log(
      `  ${c.id.padEnd(8)} openzl ${oz.encode.p50.toFixed(2)}ms ${(oz.ratio * 100).toFixed(1)}%  |  zstd3 ${zs.encode.p50.toFixed(2)}ms ${(zs.ratio * 100).toFixed(1)}%`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
