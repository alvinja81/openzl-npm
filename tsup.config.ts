import { defineConfig } from 'tsup';

/**
 * Dual ESM + CJS output.
 *
 * `bundle: false` is deliberate: every entry point must keep sharing the same
 * `core/pool.js` and `core/native.js` module instances. Bundling would inline a
 * private copy of those into each entry, so a consumer importing both
 * `openzl-express` and `openzl-express/core` would end up with two CLI process
 * pools and two native-addon caches.
 *
 * `shims: true` rewrites `import.meta.url` for the CJS output — the only
 * ESM-specific syntax in the sources (module-relative path lookup in
 * core/profiles.ts, core/pool.ts, core/native.ts).
 */
const entry = [
  'src/index.ts',
  'src/core-entry.ts',
  'src/express.ts',
  'src/fastify.ts',
  'src/types.ts',
  'src/core/*.ts',
  'src/adapters/*.ts'
];

export default defineConfig([
  {
    entry,
    outDir: 'dist',
    format: ['esm'],
    bundle: false,
    splitting: false,
    sourcemap: false,
    clean: true,
    target: 'node18',
    dts: true
  },
  {
    entry,
    outDir: 'dist/cjs',
    format: ['cjs'],
    bundle: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    target: 'node18',
    shims: true,
    dts: true,
    // Keep `.js`: with bundle:false the emitted cross-file specifiers stay
    // `./core/index.js`, so a `.cjs` extension would leave every internal
    // require unresolvable. `dist/cjs/package.json` (written by
    // scripts/finalize-dual-build.mjs) marks the directory as CommonJS.
    outExtension: () => ({ js: '.js', dts: '.d.ts' })
  }
]);
