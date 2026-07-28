#!/usr/bin/env node
/**
 * Train a custom OpenZL compressor from sample files.
 *
 *   npx openzl-train ./samples -o ./profiles/my.zlc
 *   npx openzl-train ./samples -o ./my.zlc -p serial --max-time 30
 *   npx openzl-train ./samples -o ./my.zlc --num-samples 12
 *
 * Requires a working `zli` (optionalDependency @amirja811/openzl-cli or PATH).
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');

const usage = () => {
  console.log(`Usage:
  openzl-train <samples-dir> -o <out.zlc> [options]

Options:
  -o, --output <file>     Output .zlc path (required)
  -p, --profile <name>    Base profile for training (default: serial)
  --num-samples <n>       Samples to use (default: 12)
  --max-time <secs>       Trainer time budget (default: 40)
  -h, --help              Show help

Examples:
  openzl-train ./my-metrics-samples -o ./profiles/metrics.zlc
  openzl-train ./bin-samples -o ./binary.zlc -p le-u32 --max-time 60
`);
};

const findZli = () => {
  const plat = `${process.platform}-${process.arch}`;
  const candidates = [
    path.join(pkgRoot, 'node_modules/@amirja811/openzl-cli/build/binaries', plat, 'zli'),
    path.join(process.cwd(), 'node_modules/@amirja811/openzl-cli/build/binaries', plat, 'zli'),
    path.join(pkgRoot, '@openzl-cli/build/binaries', plat, 'zli'),
    path.join(process.cwd(), 'node_modules/.bin/zli')
  ];
  try {
    const cliPkg = require.resolve('@amirja811/openzl-cli/package.json');
    const cliRoot = path.dirname(cliPkg);
    candidates.unshift(path.join(cliRoot, 'build/binaries', plat, 'zli'));
  } catch {
    // optional dep may be missing
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'zli';
};

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help') || args.length === 0) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

let samplesDir;
let output;
let profile = 'serial';
let numSamples = 12;
let maxTime = 40;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-o' || a === '--output') {
    output = args[++i];
  } else if (a === '-p' || a === '--profile') {
    profile = args[++i];
  } else if (a === '--num-samples') {
    numSamples = Number(args[++i]);
  } else if (a === '--max-time') {
    maxTime = Number(args[++i]);
  } else if (!a.startsWith('-') && !samplesDir) {
    samplesDir = a;
  } else {
    console.error('Unknown arg:', a);
    usage();
    process.exit(1);
  }
}

if (!samplesDir || !output) {
  console.error('Error: samples directory and -o <out.zlc> are required.\n');
  usage();
  process.exit(1);
}

samplesDir = path.resolve(samplesDir);
output = path.resolve(output);

if (!fs.existsSync(samplesDir) || !fs.statSync(samplesDir).isDirectory()) {
  console.error(`Samples directory not found: ${samplesDir}`);
  process.exit(1);
}

const entries = fs.readdirSync(samplesDir).filter((f) => !f.startsWith('.'));
if (entries.length === 0) {
  console.error(`No sample files in ${samplesDir}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(output), { recursive: true });

const zli = findZli();
console.log(`zli: ${zli}`);
console.log(`samples: ${samplesDir} (${entries.length} entries)`);
console.log(`base profile: ${profile}`);
console.log(`output: ${output}`);

const r = spawnSync(
  zli,
  [
    'train',
    samplesDir,
    '-p',
    profile,
    '-o',
    output,
    '-f',
    '--num-samples',
    String(numSamples),
    '--max-time-secs',
    String(maxTime)
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
);

if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);

if (r.status !== 0) {
  console.error(`\ntrain failed (exit ${r.status}). Is zli installed?`);
  console.error('  npm install @amirja811/openzl-cli');
  process.exit(r.status ?? 1);
}

const st = fs.statSync(output);
console.log(`\nWrote ${output} (${st.size} bytes)`);
console.log(`\nUse in middleware:`);
console.log(`  openzlMiddleware({ profile: ${JSON.stringify(output)} })`);
console.log(`  // or copy into your app and pass the path / relative name`);
