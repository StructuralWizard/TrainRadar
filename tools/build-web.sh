#!/usr/bin/env bash
# Build the static site in web/: WebAssembly engine + vendored MapLibre.
# Reference data (web/data) comes from refdata-build (see docs/refdata.md).
#   RT_BASE=https://proxy.example/ tools/build-web.sh   # production feed URL
set -euo pipefail
cd "$(dirname "$0")/.."

tools/build-wasm.sh
(cd web && npm ci --no-audit --no-fund --silent)
mkdir -p web/vendor/maplibre
cp web/node_modules/maplibre-gl/dist/{maplibre-gl.mjs,maplibre-gl-worker.mjs,maplibre-gl.css} \
  web/node_modules/maplibre-gl/LICENSE.txt web/vendor/maplibre/

if [ -n "${RT_BASE:-}" ]; then
  # Point the app and its CSP at the deployed feed pass-through.
  origin=$(printf '%s' "$RT_BASE" | sed -E 's#^(https://[^/]+).*#\1#')
  sed -i "s#rtBase: \"/rt/\"#rtBase: \"$RT_BASE\"#" web/js/config.js
  sed -i "s#connect-src 'self' https://tiles.openfreemap.org#connect-src 'self' https://tiles.openfreemap.org $origin#" web/index.html
fi
echo "web/ ready: serve it with  node tools/dev-server.mjs"
