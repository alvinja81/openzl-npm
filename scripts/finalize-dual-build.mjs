#!/usr/bin/env node
/**
 * Completes the dual ESM/CJS build and proves both halves actually load.
 *
 * tsup emits plain `.js` into dist/cjs so that the internal specifiers it
 * writes (`require('./core/index.js')`) resolve; this marks that directory as
 * CommonJS so Node interprets those files correctly despite the package being
 * "type": "module".
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cjsDir = path.join(root, 'dist', 'cjs');

if (!fs.existsSync(cjsDir)) {
  console.error('dist/cjs missing — run tsup first');
  process.exit(1);
}

fs.writeFileSync(
  path.join(cjsDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
);

/**
 * tsup derives the declaration extension from the format and ignores
 * `outExtension` for it, so the CJS half arrives as `.d.cts` referring to
 * `./core/*.cjs`. Inside a `"type": "commonjs"` directory the plain `.d.ts`
 * name is what TypeScript looks for next to `index.js`, so rename the files
 * and repoint their specifiers to match the `.js` output.
 */
const renameDeclarations = (dir) => {
  let renamed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      renamed += renameDeclarations(full);
      continue;
    }
    if (!entry.name.endsWith('.d.cts')) continue;
    const body = fs
      .readFileSync(full, 'utf8')
      .replace(/(from\s+['"]\.[^'"]*?)\.cjs(['"])/g, '$1.js$2')
      .replace(/(import\(['"]\.[^'"]*?)\.cjs(['"])/g, '$1.js$2');
    fs.writeFileSync(full.replace(/\.d\.cts$/, '.d.ts'), body);
    fs.unlinkSync(full);
    renamed++;
  }
  return renamed;
};

console.log(`renamed ${renameDeclarations(cjsDir)} declaration file(s) to .d.ts`);

const entries = [
  ['.', 'dist/index.js', 'dist/cjs/index.js'],
  ['./core', 'dist/core-entry.js', 'dist/cjs/core-entry.js'],
  ['./express', 'dist/express.js', 'dist/cjs/express.js'],
  ['./fastify', 'dist/fastify.js', 'dist/cjs/fastify.js']
];

let failed = 0;
const require = createRequire(import.meta.url);

for (const [name, esm, cjs] of entries) {
  for (const [kind, rel] of [
    ['esm', esm],
    ['cjs', cjs]
  ]) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      console.error(`✗ ${name} ${kind}: missing ${rel}`);
      failed++;
      continue;
    }
    try {
      const mod =
        kind === 'esm' ? await import(pathToFileURL(file).href) : require(file);
      const keys = Object.keys(mod).filter((k) => k !== 'default');
      if (keys.length === 0) {
        console.error(`✗ ${name} ${kind}: no exports`);
        failed++;
        continue;
      }
      console.log(`✓ ${name.padEnd(10)} ${kind}  ${keys.length} exports`);
    } catch (err) {
      console.error(`✗ ${name} ${kind}: ${err.message}`);
      failed++;
    }
  }
}

// Type declarations must exist for both conditions or editors fall back to any.
for (const rel of [
  'dist/index.d.ts',
  'dist/core-entry.d.ts',
  'dist/express.d.ts',
  'dist/fastify.d.ts',
  'dist/cjs/index.d.ts',
  'dist/cjs/core-entry.d.ts',
  'dist/cjs/express.d.ts',
  'dist/cjs/fastify.d.ts'
]) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.error(`✗ missing types: ${rel}`);
    failed++;
  }
}

if (failed) {
  console.error(`\ndual build check: ${failed} problem(s)`);
  process.exit(1);
}
console.log('\ndual build ok (esm + cjs load, types present)');
