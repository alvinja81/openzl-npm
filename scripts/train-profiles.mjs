#!/usr/bin/env node
/**
 * Regenerate shipped trained compressors under profiles/.
 *
 * Requires a working zli binary (prebuilt openzl-cli or local build).
 *
 *   npm run train:profiles
 *   npm run train:profiles -- --max-time 20
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilesDir = path.join(root, 'profiles');
const samplesDir = path.join(profilesDir, 'samples');

const maxTimeArg = (() => {
  const i = process.argv.indexOf('--max-time');
  return i >= 0 ? Number(process.argv[i + 1]) : 40;
})();

const findZli = () => {
  const candidates = [
    path.join(root, 'node_modules/@amirja811/openzl-cli/build/binaries', `${process.platform}-${process.arch}`, 'zli'),
    path.join(root, '@openzl-cli/build/binaries', `${process.platform}-${process.arch}`, 'zli'),
    path.join(root, 'node_modules/.bin/zli')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'zli';
};

const zli = findZli();
console.log('zli:', zli);

const writeSamples = () => {
  const tsDir = path.join(samplesDir, 'timeseries');
  const apiDir = path.join(samplesDir, 'api-list');
  const proseDir = path.join(samplesDir, 'prose');
  const binDir = path.join(samplesDir, 'binary');
  for (const d of [tsDir, apiDir, proseDir, binDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  for (let s = 0; s < 20; s++) {
    const points = [];
    for (let i = 0; i < 200; i++) {
      points.push({
        t: 1_700_000_000 + s * 1000 + i,
        sensor: `s${i % 8}`,
        temp: 20 + Math.sin(i / 17) * 5 + (i % 7) * 0.01,
        humidity: 40 + Math.cos(i / 23) * 10,
        pressure: 1013.25 + Math.sin(i / 41) * 2,
        battery: 100 - (i % 100) * 0.05
      });
    }
    fs.writeFileSync(
      path.join(tsDir, `sample-${s}.json`),
      JSON.stringify({ series: 'env-v1', points })
    );
  }

  const statuses = ['active', 'pending', 'closed', 'archived'];
  for (let s = 0; s < 15; s++) {
    const data = [];
    for (let i = 0; i < 80; i++) {
      data.push({
        id: `usr_${1000 + (i % 50)}`,
        email: `user${i % 40}@example.com`,
        name: `User ${i % 30}`,
        status: statuses[i % 4],
        role: ['admin', 'user', 'viewer'][i % 3],
        createdAt: new Date(1_700_000_000_000 + i * 60_000).toISOString()
      });
    }
    fs.writeFileSync(
      path.join(apiDir, `sample-${s}.json`),
      JSON.stringify({ ok: true, data })
    );
  }

  const LOREM =
    'The quick brown fox jumps over the lazy dog. In distributed systems, partial failure is the norm. ';
  for (let s = 0; s < 10; s++) {
    const notes = [];
    for (let i = 0; i < 30; i++) {
      notes.push({
        id: i,
        title: `Note ${i}`,
        body: LOREM.repeat(2 + (i % 3)) + ` token_${s}_${i}`
      });
    }
    fs.writeFileSync(
      path.join(proseDir, `sample-${s}.json`),
      JSON.stringify({ type: 'journal', notes })
    );
  }

  for (let s = 0; s < 10; s++) {
    const buf = Buffer.alloc(500 * 16);
    for (let i = 0; i < 500; i++) {
      const off = i * 16;
      buf.writeUInt32LE(i + s * 1000, off);
      buf.writeUInt32LE((i * 17) % 1_000_000, off + 4);
      buf.writeFloatLE(20 + Math.sin(i / 13) * 5, off + 8);
      buf.writeUInt16LE(i % 8, off + 12);
      buf.writeUInt16LE(i % 4 === 0 ? 1 : 0, off + 14);
    }
    fs.writeFileSync(path.join(binDir, `sample-${s}.bin`), buf);
  }
  console.log('samples written under', samplesDir);
};

const train = (sampleSubdir, outName, profile, numSamples) => {
  const samplePath = path.join(samplesDir, sampleSubdir);
  const outPath = path.join(profilesDir, outName);
  console.log(`\n→ train ${sampleSubdir} -p ${profile} → ${outName}`);
  const r = spawnSync(
    zli,
    [
      'train',
      samplePath,
      '-p',
      profile,
      '-o',
      outPath,
      '-f',
      '--num-samples',
      String(numSamples),
      '--max-time-secs',
      String(maxTimeArg)
    ],
    { encoding: 'utf8', cwd: root }
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`train failed for ${outName} (exit ${r.status})`);
  }
  const st = fs.statSync(outPath);
  console.log(`  wrote ${outPath} (${st.size} bytes)`);
};

const compare = (sampleSubdir, zlcName, fileGlob) => {
  const dir = path.join(samplesDir, sampleSubdir);
  const sample = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('sample-0'))
    .map((f) => path.join(dir, f))[0];
  if (!sample) return;
  const serialOut = path.join(root, 'tmp-serial.zl');
  const trainedOut = path.join(root, 'tmp-trained.zl');
  spawnSync(zli, ['compress', sample, '-o', serialOut, '-p', 'serial', '-f', '--verbose', '0']);
  spawnSync(zli, [
    'compress',
    sample,
    '-o',
    trainedOut,
    '-c',
    path.join(profilesDir, zlcName),
    '-f',
    '--verbose',
    '0'
  ]);
  const orig = fs.statSync(sample).size;
  const s = fs.existsSync(serialOut) ? fs.statSync(serialOut).size : -1;
  const t = fs.existsSync(trainedOut) ? fs.statSync(trainedOut).size : -1;
  console.log(
    `  compare ${sampleSubdir}: orig=${orig} serial=${s} trained=${t} Δ=${s > 0 && t > 0 ? (((s - t) / s) * 100).toFixed(1) + '%' : 'n/a'}`
  );
  try {
    fs.unlinkSync(serialOut);
    fs.unlinkSync(trainedOut);
  } catch {
    // ignore
  }
};

writeSamples();
train('timeseries', 'timeseries.zlc', 'serial', 12);
train('api-list', 'api-list.zlc', 'serial', 12);
train('prose', 'prose.zlc', 'serial', 8);
train('binary', 'binary.zlc', 'serial', 8);
train('binary', 'binary-le-u32.zlc', 'le-u32', 8);

console.log('\n--- ratio check (sample-0) ---');
compare('timeseries', 'timeseries.zlc');
compare('api-list', 'api-list.zlc');
compare('prose', 'prose.zlc');
compare('binary', 'binary.zlc');
console.log('\nDone. Profiles ready under profiles/');
