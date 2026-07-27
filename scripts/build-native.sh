#!/usr/bin/env bash
# Build the N-API addon (requires openzl/build-lib from build-openzl.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f openzl/build-lib/libopenzl.a ]]; then
  echo "Building OpenZL library first..."
  bash scripts/build-openzl.sh
fi

# cmake-js compiles native/ → native/build/Release/openzl_native.node
npx cmake-js compile --directory native "$@"
echo "Native addon ready:"
ls -la native/build/Release/openzl_native.node 2>/dev/null \
  || ls -la native/build/*/openzl_native.node 2>/dev/null \
  || find native/build -name 'openzl_native.node' 2>/dev/null
