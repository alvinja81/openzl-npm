/**
 * Experimental browser entry for openzl-express.
 *
 * Primary product path is Node (core / Express / Fastify) with gzip/zstd.
 * See docs/BROWSER.md — this surface may change without a major version bump.
 */

let warned = false;
const warnExperimental = () => {
  if (warned) return;
  warned = true;
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      '[openzl-express/browser] experimental: ~1.3MB wasm64 decoder. ' +
        'Prefer gzip/zstd for public web. See docs/BROWSER.md'
    );
  }
};

warnExperimental();

export {
  createDecoder,
  amortization
} from './openzl-decoder.js';

export { createOpenZLFetch } from './fetch-openzl.js';
