#!/usr/bin/env bash
# Build OpenZL decode-only WASM (wasm64 / MEMORY64) + JS glue.
#
# Requires: emcc on PATH (brew install emscripten)
# Optional: OPENZL_ROOT (default ./openzl)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENZL_ROOT="${OPENZL_ROOT:-$ROOT/openzl}"
BUILD_DIR="${OPENZL_WASM_BUILD:-$OPENZL_ROOT/build-wasm}"
OUT_DIR="$ROOT/browser/dist"
GLUE="$ROOT/wasm/src/openzl_decode.c"

export PATH="/opt/homebrew/opt/emscripten/bin:${PATH:-}"

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found. Install: brew install emscripten" >&2
  exit 1
fi

if [[ ! -f "$OPENZL_ROOT/CMakeLists.txt" ]]; then
  echo "OpenZL sources missing at $OPENZL_ROOT" >&2
  echo "git clone --depth 1 https://github.com/facebook/openzl.git openzl" >&2
  exit 1
fi

if [[ ! -f "$BUILD_DIR/libopenzl.a" ]]; then
  echo "→ Configuring & building libopenzl for wasm64 (first time is slow)..."
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR"
  # OpenZL requires 64-bit size_t → MEMORY64 / wasm64
  ( cd "$BUILD_DIR" && emcmake cmake "$OPENZL_ROOT" \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_C_FLAGS="-sMEMORY64=1 -O3" \
      -DCMAKE_CXX_FLAGS="-sMEMORY64=1 -O3" \
      -DCMAKE_EXE_LINKER_FLAGS="-sMEMORY64=1" \
      -DOPENZL_BUILD_TESTS=OFF \
      -DOPENZL_BUILD_BENCHMARKS=OFF \
      -DOPENZL_BUILD_CLI=OFF \
      -DOPENZL_BUILD_EXAMPLES=OFF \
      -DOPENZL_BUILD_PYTHON_EXT=OFF \
      -DOPENZL_BUILD_TOOLS=OFF \
      -DOPENZL_BUILD_CUSTOM_PARSERS=OFF \
      -DOPENZL_BUILD_CPP=OFF \
      -DOPENZL_INSTALL=OFF \
      -DOPENZL_ALLOW_INTROSPECTION=OFF )
  ( cd "$BUILD_DIR" && emmake cmake --build . --target openzl -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)" )
else
  echo "→ Reusing $BUILD_DIR/libopenzl.a"
fi

mkdir -p "$OUT_DIR"
echo "→ Linking openzl_decode.wasm..."
emcc \
  -O3 -flto \
  -sMEMORY64=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createOpenZL \
  -sENVIRONMENT=web,webview,worker,node \
  -sEXPORTED_FUNCTIONS='["_openzl_decompress","_openzl_get_decompressed_size","_openzl_last_error","_openzl_version","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8","UTF8ToString","getValue","setValue"]' \
  -sFILESYSTEM=0 \
  -sASSERTIONS=0 \
  -I"$OPENZL_ROOT/include" \
  -I"$OPENZL_ROOT/src" \
  -I"$OPENZL_ROOT" \
  -I"$BUILD_DIR/include" \
  "$GLUE" \
  "$BUILD_DIR/libopenzl.a" \
  "$BUILD_DIR/zstd_build/lib/libzstd.a" \
  "$BUILD_DIR/lz4_build/liblz4.a" \
  -o "$OUT_DIR/openzl_decode.js"

echo "→ Built:"
ls -lh "$OUT_DIR/openzl_decode.js" "$OUT_DIR/openzl_decode.wasm"
WASM_BYTES=$(wc -c < "$OUT_DIR/openzl_decode.wasm" | tr -d ' ')
echo "WASM_BYTES=$WASM_BYTES"
echo "$WASM_BYTES" > "$OUT_DIR/wasm_bytes.txt"
