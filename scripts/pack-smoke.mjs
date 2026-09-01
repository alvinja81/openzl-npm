#!/usr/bin/env node
/**
 * Pack the package and install into a temp directory — proves a stranger's npm i.
 *   node scripts/pack-smoke.mjs
 *
 * Does not require network for native prebuilds (may warn and continue).
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openzl-pack-'));

const run = (cmd, cwd = root) => {
  console.log('$', cmd);
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });
};

try {
  console.log('tmpdir', tmp);
  run('npm run build');
  const packOut = run('npm pack --json');
  const packInfo = JSON.parse(packOut);
  const tgzName = packInfo[0]?.filename || packInfo.filename;
  if (!tgzName) throw new Error('npm pack produced no filename');
  const tgz = path.join(root, tgzName);
  if (!fs.existsSync(tgz)) throw new Error(`missing ${tgz}`);

  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'openzl-pack-smoke', private: true, type: 'module' }, null, 2)
  );

  // Install tarball only (no full optional CLI fetch required for smoke)
  run(`npm install "${tgz}" --no-fund --no-audit`, tmp);

  const probe = `
import {
  pickEncoding,
  isZstdAvailable,
  isBrotliAvailable,
  compressGzip,
  compressBrotli,
  decompressBrotli,
  openzlMiddleware
} from 'openzl-express';
import { openzlMiddleware as fromExpress } from 'openzl-express/express';
import * as core from 'openzl-express/core';

if (pickEncoding('*') !== 'gzip') throw new Error('negotiate *');
if (pickEncoding('gzip, deflate, br') !== 'br') throw new Error('negotiate br');
if (typeof openzlMiddleware !== 'function') throw new Error('middleware');
if (typeof fromExpress !== 'function') throw new Error('express subpath');
if (typeof core.compress !== 'function') throw new Error('core.compress');
if (typeof core.compressBrotli !== 'function') throw new Error('core.compressBrotli');
if (typeof core.createOpenZLFetch !== 'function') throw new Error('core.createOpenZLFetch');
const payload = Buffer.from('hello world '.repeat(100));
const gz = await compressGzip(payload);
if (!gz.length) throw new Error('gzip empty');
const br = await compressBrotli(payload);
if (!(await decompressBrotli(br)).equals(payload)) throw new Error('brotli roundtrip');
console.log(JSON.stringify({
  ok: true,
  zstd: isZstdAvailable(),
  brotli: isBrotliAvailable(),
  gzipBytes: gz.length,
  brotliBytes: br.length,
  encodings: ['openzl','zstd','br','gzip']
}));
`;
  fs.writeFileSync(path.join(tmp, 'probe.mjs'), probe);
  const out = run('node probe.mjs', tmp);
  console.log(out.trim());

  // CommonJS consumers must get a working build from the same tarball.
  const cjsProbe = `
const {
  pickEncoding,
  compressGzip,
  compressBrotli,
  openzlMiddleware
} = require('openzl-express');
const { openzlMiddleware: fromExpress } = require('openzl-express/express');
const core = require('openzl-express/core');

if (pickEncoding('gzip, deflate, br') !== 'br') throw new Error('cjs negotiate');
if (typeof openzlMiddleware !== 'function') throw new Error('cjs middleware');
if (typeof fromExpress !== 'function') throw new Error('cjs express subpath');
if (typeof core.compress !== 'function') throw new Error('cjs core.compress');

// One shared module instance across entry points: a bundled build would give
// each entry its own CLI pool and native cache.
if (core.pickEncoding !== pickEncoding) throw new Error('cjs entries not sharing modules');

compressGzip(Buffer.from('x'.repeat(200)))
  .then((gz) => compressBrotli(Buffer.from('x'.repeat(200))).then((br) => {
    console.log(JSON.stringify({ cjs: true, gzipBytes: gz.length, brotliBytes: br.length }));
  }))
  .catch((e) => { console.error(e); process.exit(1); });
`;
  fs.writeFileSync(path.join(tmp, 'probe.cjs'), cjsProbe);
  console.log(run('node probe.cjs', tmp).trim());

  console.log('\npack-smoke ok (esm + cjs)');
} catch (e) {
  console.error('pack-smoke failed:', e.stdout || e.stderr || e.message);
  if (e.stdout) console.error(e.stdout);
  if (e.stderr) console.error(e.stderr);
  process.exit(1);
} finally {
  // leave tgz in repo root cleaned
  try {
    for (const f of fs.readdirSync(root)) {
      if (f.endsWith('.tgz') && f.startsWith('openzl-express-')) {
        fs.unlinkSync(path.join(root, f));
      }
    }
  } catch {
    // ignore
  }
}
