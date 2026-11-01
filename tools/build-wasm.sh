#!/usr/bin/env bash
# Build the engine to WebAssembly into web/pkg and print a size report.
# Requires: wasm32-unknown-unknown target, wasm-bindgen-cli matching the
# wasm-bindgen crate version. wasm-opt (binaryen) is used when available.
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build -p trainradar-engine --release --target wasm32-unknown-unknown
wasm-bindgen --target web --no-typescript --out-dir web/pkg --out-name engine \
  target/wasm32-unknown-unknown/release/trainradar_engine.wasm

if command -v wasm-opt >/dev/null; then
  wasm-opt -Os --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
    --enable-mutable-globals web/pkg/engine_bg.wasm -o web/pkg/engine_bg.wasm
  opt="yes"
else
  opt="no (install binaryen for smaller output)"
fi

size() { wc -c <"$1" | tr -d ' '; }
gz() { gzip -9c "$1" | wc -c | tr -d ' '; }
{
  echo "### WASM bundle size"
  echo
  echo "| File | Raw | gzip -9 |"
  echo "|---|---:|---:|"
  for f in web/pkg/engine_bg.wasm web/pkg/engine.js; do
    echo "| \`$(basename "$f")\` | $(size "$f") B | $(gz "$f") B |"
  done
  echo
  echo "wasm-opt: $opt"
} | tee "${SIZE_REPORT:-/dev/null}"
