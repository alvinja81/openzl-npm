#!/usr/bin/env bash
# Build static libopenzl (+ zstd/lz4 deps) into openzl/build-lib.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENZL_ROOT="${OPENZL_ROOT:-$ROOT/openzl}"
BUILD_DIR="${OPENZL_BUILD:-$OPENZL_ROOT/build-lib}"

if [[ ! -f "$OPENZL_ROOT/CMakeLists.txt" ]]; then
  echo "openzl sources not found at $OPENZL_ROOT" >&2
  echo "Clone with: git clone --depth 1 https://github.com/facebook/openzl.git openzl" >&2
  exit 1
fi

if [[ -f "$BUILD_DIR/libopenzl.a" && "${FORCE_REBUILD:-}" != "1" ]]; then
  echo "libopenzl.a already present at $BUILD_DIR (set FORCE_REBUILD=1 to rebuild)"
  exit 0
fi

cmake -S "$OPENZL_ROOT" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DOPENZL_BUILD_TESTS=OFF \
  -DOPENZL_BUILD_BENCHMARKS=OFF \
  -DOPENZL_BUILD_CLI=OFF \
  -DOPENZL_BUILD_EXAMPLES=OFF \
  -DOPENZL_BUILD_PYTHON_EXT=OFF \
  -DOPENZL_BUILD_TOOLS=OFF \
  -DOPENZL_BUILD_CUSTOM_PARSERS=OFF \
  -DOPENZL_BUILD_CPP=ON \
  -DOPENZL_INSTALL=OFF \
  -DOPENZL_ALLOW_INTROSPECTION=OFF

JOBS="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)}"
cmake --build "$BUILD_DIR" --target openzl -j"$JOBS"

echo "Built $BUILD_DIR/libopenzl.a"
