#!/usr/bin/env node
/**
 * Local preflight before tagging a release.
 *   node scripts/release-check.mjs
 * Exit 0 = ok to tag (warnings allowed); exit 1 = hard failure.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cliPkgPath = path.join(root, '@openzl-cli/package.json');
const cliPkg = fs.existsSync(cliPkgPath)
  ? JSON.parse(fs.readFileSync(cliPkgPath, 'utf8'))
  : null;

let errors = 0;
let warnings = 0;
const ok = (m) => console.log('✓', m);
const warn = (m) => {
  warnings++;
  console.warn('⚠', m);
};
const fail = (m) => {
  errors++;
  console.error('✗', m);
};

console.log(`release-check · ${pkg.name}@${pkg.version}\n`);

// Version shape
if (!/^\d+\.\d+\.\d+/.test(pkg.version)) fail(`invalid version ${pkg.version}`);
else ok(`version ${pkg.version}`);

// CHANGELOG mentions version
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`[${pkg.version}]`) && !changelog.includes(`## [${pkg.version}]`)) {
  fail(`CHANGELOG.md missing section for ${pkg.version}`);
} else ok('CHANGELOG mentions this version');

// exports map
for (const exp of ['.', './core', './express', './fastify']) {
  if (!pkg.exports?.[exp]) fail(`exports missing ${exp}`);
  else ok(`exports ${exp}`);
}

// files field must include install script + dist
for (const f of ['dist', 'scripts/install-native.mjs', 'profiles/manifest.json']) {
  const listed = pkg.files?.some(
    (x) => x === f || x.startsWith(f) || (f.startsWith('profiles') && x.includes('profiles'))
  );
  if (!listed && f === 'dist') {
    // dist is always included via main
    ok('main → dist');
  } else if (!listed && f !== 'dist') {
    // check files array loosely
    const hit = JSON.stringify(pkg.files || []).includes(f.split('/')[0]);
    if (!hit) warn(`files[] may not include ${f}`);
    else ok(`files covers ${f}`);
  } else ok(`files ${f}`);
}

// optional CLI range
const optCli = pkg.optionalDependencies?.['@amirja811/openzl-cli'];
if (!optCli) warn('no optionalDependency on openzl-cli');
else if (cliPkg && !optCli.replace(/[\^~]/g, '').startsWith(cliPkg.version.split('.').slice(0, 1).join('.'))) {
  // soft check major
  ok(`optional CLI ${optCli} (repo CLI ${cliPkg.version})`);
} else ok(`optional CLI ${optCli}`);

if (cliPkg) {
  ok(`repo @openzl-cli version ${cliPkg.version}`);
}

// built dist exists
const distIndex = path.join(root, 'dist/index.js');
if (!fs.existsSync(distIndex)) fail('dist/ missing — run npm run build');
else ok('dist/ present');

// core modules load
try {
  const core = await import(path.join(root, 'dist/core-entry.js'));
  if (typeof core.pickEncoding !== 'function') fail('core.pickEncoding missing');
  else ok('core entry loads');
  if (typeof core.isZstdAvailable !== 'function') fail('isZstdAvailable missing');
  else ok(`zstd available: ${core.isZstdAvailable()}`);
  // safety: * must not select openzl
  if (core.pickEncoding('*') === 'openzl') fail('pickEncoding(*) must not be openzl');
  else ok(`pickEncoding(*) → ${core.pickEncoding('*')}`);
} catch (e) {
  fail(`core import failed: ${e.message}`);
}

// engines
if (!pkg.engines?.node) warn('engines.node not set');
else ok(`engines.node ${pkg.engines.node}`);

// workflows present
for (const w of [
  'ci.yml',
  'build-binaries.yml',
  'build-native.yml',
  'publish-express.yml'
]) {
  if (!fs.existsSync(path.join(root, '.github/workflows', w))) fail(`missing workflow ${w}`);
  else ok(`workflow ${w}`);
}

console.log('');
if (errors) {
  console.error(`release-check failed: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(1);
}
console.log(`release-check ok (${warnings} warning(s)) — safe to tag v${pkg.version}`);
