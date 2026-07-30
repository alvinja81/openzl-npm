/**
 * Phase 5 tests: the dual ESM/CJS package resolves for real consumers.
 *
 * Runtime loading is covered by pack-smoke; this checks the half that silently
 * degrades instead of throwing — TypeScript resolution. Under
 * `moduleResolution: node16` a consumer picks the `import` or `require`
 * condition based on its own module kind, so a missing or misordered `types`
 * entry leaves users with `any` (or an error) while JS keeps working.
 *
 *   node scripts/test-dual.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = path.join(root, 'node_modules', '.bin', 'tsc');

let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(pass ? '✓' : '✗', name, pass ? '' : detail);
  if (!pass) failed++;
};

const run = (cmd, cwd) =>
  execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

console.log('Phase 5 dual-package tests');

// The exports map must offer both conditions, each with its own types.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const sub of ['.', './core', './express', './fastify']) {
  const e = pkg.exports[sub];
  ok(`exports ${sub} has import+require`, !!e?.import && !!e?.require);
  ok(
    `exports ${sub} types precede default`,
    Object.keys(e.import)[0] === 'types' && Object.keys(e.require)[0] === 'types',
    JSON.stringify(e)
  );
  for (const cond of ['import', 'require']) {
    for (const key of ['types', 'default']) {
      const rel = e[cond][key].replace(/^\.\//, '');
      ok(`${sub} ${cond}.${key} exists`, fs.existsSync(path.join(root, rel)), rel);
    }
  }
}

// CJS output must not leak ESM syntax, and must not be read as ESM.
const cjsMarker = path.join(root, 'dist/cjs/package.json');
ok(
  'dist/cjs is marked commonjs',
  fs.existsSync(cjsMarker) &&
    JSON.parse(fs.readFileSync(cjsMarker, 'utf8')).type === 'commonjs'
);
const cjsIndex = fs.readFileSync(path.join(root, 'dist/cjs/index.js'), 'utf8');
ok('cjs output has no import.meta', !cjsIndex.includes('import.meta'));
ok('cjs output has no ESM export syntax', !/^export\s/m.test(cjsIndex));

// Shared module instances: bundling would give each entry its own CLI pool.
const esmCore = fs.readFileSync(path.join(root, 'dist/core-entry.js'), 'utf8');
ok(
  'entries import shared core rather than inlining it',
  /from ['"]\.\/core\/index\.js['"]/.test(esmCore) ||
    /from ['"]\.\/core\//.test(esmCore),
  esmCore.slice(0, 120)
);

// Now the real consumer check, against the packed tarball.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openzl-dual-'));
try {
  const packed = JSON.parse(run('npm pack --json', root));
  const tarball = path.join(root, packed[0].filename);

  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'dual-consumer', version: '1.0.0', private: true }, null, 2)
  );
  run(`npm install "${tarball}" --no-fund --no-audit --ignore-scripts`, tmp);
  fs.cpSync(path.join(root, 'node_modules', 'typescript'), path.join(tmp, 'node_modules', 'typescript'), {
    recursive: true
  });
  fs.cpSync(path.join(root, 'node_modules', '@types'), path.join(tmp, 'node_modules', '@types'), {
    recursive: true
  });

  const cases = [
    {
      name: 'ESM consumer (module: node16)',
      moduleKind: 'module',
      file: 'consumer.mts',
      source: `
import { pickEncoding, compressBrotli, openzlMiddleware } from 'openzl-express';
import { openzlMiddleware as viaExpress } from 'openzl-express/express';
import { compress } from 'openzl-express/core';
const enc: 'openzl' | 'zstd' | 'br' | 'gzip' | 'identity' = pickEncoding('br');
const mw: unknown = openzlMiddleware({ threshold: 1024, brotliQuality: 4 });
const mw2: unknown = viaExpress({ allowBrotli: false });
export const use = [enc, mw, mw2, compressBrotli, compress];
`
    },
    {
      name: 'CJS consumer (module: node16)',
      moduleKind: 'commonjs',
      file: 'consumer.cts',
      source: `
import { pickEncoding, compressBrotli, openzlMiddleware } from 'openzl-express';
import { openzlMiddleware as viaExpress } from 'openzl-express/express';
import { compress } from 'openzl-express/core';
const enc: 'openzl' | 'zstd' | 'br' | 'gzip' | 'identity' = pickEncoding('br');
const mw: unknown = openzlMiddleware({ threshold: 1024, brotliQuality: 4 });
const mw2: unknown = viaExpress({ allowBrotli: false });
export const use = [enc, mw, mw2, compressBrotli, compress];
`
    }
  ];

  for (const c of cases) {
    fs.writeFileSync(path.join(tmp, c.file), c.source);
    const tsconfig = {
      compilerOptions: {
        module: 'node16',
        moduleResolution: 'node16',
        target: 'es2022',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node']
      },
      files: [c.file]
    };
    const cfg = path.join(tmp, `tsconfig.${c.moduleKind}.json`);
    fs.writeFileSync(cfg, JSON.stringify(tsconfig, null, 2));
    try {
      run(`"${tsc}" -p "${cfg}"`, tmp);
      ok(c.name, true);
    } catch (err) {
      const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
      ok(c.name, false, out.split('\n').slice(0, 4).join(' | '));
    }
  }

  // And the runtime require() of the same install.
  fs.writeFileSync(
    path.join(tmp, 'rt.cjs'),
    `const m = require('openzl-express');
     if (m.pickEncoding('gzip, deflate, br') !== 'br') throw new Error('cjs negotiate');
     console.log('cjs-runtime-ok');`
  );
  try {
    ok('CJS require() at runtime', run('node rt.cjs', tmp).includes('cjs-runtime-ok'));
  } catch (err) {
    ok('CJS require() at runtime', false, String(err.stderr ?? err.message).slice(0, 200));
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exitCode = 1;
} else {
  console.log('\ndual-package tests all passed');
}
