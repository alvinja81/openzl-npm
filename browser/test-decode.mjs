/**
 * Smoke-test WASM decoder against a CLI-produced .zl frame.
 *   node browser/test-decode.mjs [path.zl]
 *
 * MEMORY64: pointers and size_t are BigInt in the Emscripten glue.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const createOpenZL = (await import(join(here, 'dist/openzl_decode.js'))).default;

const framePath = process.argv[2] || '/tmp/oz-wasm.zl';
const frame = readFileSync(framePath);

const Module = await createOpenZL({
  locateFile: (p) => join(here, 'dist', p)
});

// MEMORY64: C size_t / pointers are BigInt at the FFI boundary;
// HEAPU8 and _malloc still use Number addresses in practice.
const bi = (n) => BigInt(n);
const num = (x) => (typeof x === 'bigint' ? Number(x) : Number(x));

const srcPtr = Module._malloc(frame.length);
Module.HEAPU8.set(frame, num(srcPtr));

const sizeRaw = Module._openzl_get_decompressed_size(bi(srcPtr), bi(frame.length));
const size = num(sizeRaw);
if (!size) {
  console.error(
    'get_decompressed_size failed:',
    Module.UTF8ToString(Module._openzl_last_error())
  );
  process.exit(1);
}

const dstPtr = Module._malloc(size);
const outLenPtr = Module._malloc(8);
const rc = Module._openzl_decompress(
  bi(srcPtr),
  bi(frame.length),
  bi(dstPtr),
  bi(size),
  bi(outLenPtr)
);
if (Number(rc) !== 0) {
  console.error(
    'decompress failed:',
    Module.UTF8ToString(Module._openzl_last_error())
  );
  process.exit(1);
}

const written = num(Module.getValue(outLenPtr, 'i64'));
const out = Buffer.from(
  Module.HEAPU8.subarray(num(dstPtr), num(dstPtr) + written)
);
console.log('ok bytes=', written);
console.log(out.toString('utf8'));

Module._free(srcPtr);
Module._free(dstPtr);
Module._free(outLenPtr);
