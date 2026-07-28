/**
 * High-level OpenZL WASM decoder for browsers and Node.
 *
 *   import { createDecoder } from './openzl-decoder.js';
 *   const dec = await createDecoder();
 *   const bytes = await dec.decompress(uint8Array);
 *
 * Requires wasm64 / MEMORY64 (OpenZL is 64-bit only).
 * Chrome 133+, recent Firefox/Safari with wasm64 — see README.
 */

const bi = (n) => BigInt(n);
const num = (x) => (typeof x === 'bigint' ? Number(x) : Number(x));

/**
 * @param {object} [options]
 * @param {string} [options.wasmUrl] - URL/path to openzl_decode.wasm
 * @param {string} [options.glueUrl] - URL/path to openzl_decode.js (module)
 * @param {function} [options.locateFile]
 * @param {function} [options.importGlue] - async () => createOpenZL factory
 */
export async function createDecoder(options = {}) {
  const glueUrl = options.glueUrl ?? new URL('./dist/openzl_decode.js', import.meta.url).href;
  const wasmUrl = options.wasmUrl ?? new URL('./dist/openzl_decode.wasm', import.meta.url).href;

  let createOpenZL;
  if (options.importGlue) {
    createOpenZL = await options.importGlue();
  } else {
    const mod = await import(/* @vite-ignore */ glueUrl);
    createOpenZL = mod.default ?? mod.createOpenZL ?? mod;
  }

  const Module = await createOpenZL({
    locateFile: options.locateFile ?? ((p) => (p.endsWith('.wasm') ? wasmUrl : p)),
    ...options.moduleOptions
  });

  const lastError = () => {
    try {
      return Module.UTF8ToString(Module._openzl_last_error()) || 'unknown error';
    } catch {
      return 'unknown error';
    }
  };

  /**
   * @param {ArrayBuffer|ArrayBufferView} input
   * @returns {Uint8Array}
   */
  function decompress(input) {
    const frame =
      input instanceof Uint8Array
        ? input
        : input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

    if (frame.byteLength === 0) {
      throw new Error('openzl: empty input');
    }

    const srcPtr = Module._malloc(frame.byteLength);
    try {
      Module.HEAPU8.set(frame, num(srcPtr));
      const size = num(
        Module._openzl_get_decompressed_size(bi(srcPtr), bi(frame.byteLength))
      );
      if (!size) {
        throw new Error(`openzl: get_decompressed_size failed: ${lastError()}`);
      }

      const dstPtr = Module._malloc(size);
      const outLenPtr = Module._malloc(8);
      try {
        const rc = Module._openzl_decompress(
          bi(srcPtr),
          bi(frame.byteLength),
          bi(dstPtr),
          bi(size),
          bi(outLenPtr)
        );
        if (Number(rc) !== 0) {
          throw new Error(`openzl: decompress failed: ${lastError()}`);
        }
        const written = num(Module.getValue(outLenPtr, 'i64'));
        // Copy out so free() is safe
        return new Uint8Array(
          Module.HEAPU8.subarray(num(dstPtr), num(dstPtr) + written)
        ).slice();
      } finally {
        Module._free(dstPtr);
        Module._free(outLenPtr);
      }
    } finally {
      Module._free(srcPtr);
    }
  }

  /**
   * Decode as UTF-8 text (JSON APIs).
   * @param {ArrayBuffer|ArrayBufferView} input
   * @returns {string}
   */
  function decompressText(input) {
    const bytes = decompress(input);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /**
   * Decode JSON payload.
   * @param {ArrayBuffer|ArrayBufferView} input
   * @returns {unknown}
   */
  function decompressJSON(input) {
    return JSON.parse(decompressText(input));
  }

  /** Approximate WASM binary size for amortization (set at build time if known). */
  const wasmBytes =
    typeof options.wasmBytes === 'number' ? options.wasmBytes : null;

  return {
    decompress,
    decompressText,
    decompressJSON,
    wasmBytes,
    /** Raw Emscripten module (advanced). */
    module: Module
  };
}

/**
 * Amortization: when is OpenZL+WASM cheaper on the wire than gzip?
 *
 *   wasm_bytes + Σ openzl_compressed  <  Σ gzip_compressed
 *
 * @param {object} p
 * @param {number} p.wasmBytes - size of openzl_decode.wasm
 * @param {number} p.openzlTotal - sum of OpenZL response bodies (bytes)
 * @param {number} p.gzipTotal - sum of gzip response bodies (bytes)
 * @returns {{ worthIt: boolean, openzlCost: number, gzipCost: number, breakEvenOpenzlBytes: number, saved: number }}
 */
export function amortization(p) {
  const openzlCost = p.wasmBytes + p.openzlTotal;
  const gzipCost = p.gzipTotal;
  const saved = gzipCost - openzlCost;
  // openzlTotal needs to save more than wasmBytes vs gzip:
  // gzipTotal - openzlTotal > wasmBytes  => openzlTotal < gzipTotal - wasmBytes
  const breakEvenOpenzlBytes = Math.max(0, p.gzipTotal - p.wasmBytes);
  return {
    worthIt: openzlCost < gzipCost,
    openzlCost,
    gzipCost,
    breakEvenOpenzlBytes,
    saved
  };
}

/**
 * Estimate main-thread block time for a decode (ms).
 * Call only after createDecoder(); uses performance.now around decompress.
 *
 * @param {Awaited<ReturnType<typeof createDecoder>>} decoder
 * @param {Uint8Array} frame
 * @param {number} [repeats=5]
 */
export function measureDecodeMs(decoder, frame, repeats = 5) {
  // warmup
  decoder.decompress(frame);
  const samples = [];
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now();
    decoder.decompress(frame);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: samples[Math.floor(samples.length / 2)],
    min: samples[0],
    max: samples[samples.length - 1],
    samples
  };
}
