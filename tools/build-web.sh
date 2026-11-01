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
# DIST=dir [DATA_DIR=dir] [VERSION=id]: assemble a deployable copy without
# node_modules, with reference data and a versioned service worker.
if [ -n "${DIST:-}" ]; then
  rm -rf "$DIST" && mkdir -p "$DIST"
  cp -r web/index.html web/main.js web/app.css web/icon.svg web/icons web/js web/pkg web/vendor \
    web/manifest.webmanifest web/sw.js web/_headers "$DIST"/
  rm -f "$DIST"/js/*.test.mjs "$DIST"/pkg/.gitignore "$DIST"/pkg/.gitkeep
  sed -i "s#const VERSION = \"dev\";#const VERSION = \"${VERSION:-$(date +%s)}\";#" "$DIST/sw.js"
  if [ -n "${DATA_DIR:-}" ]; then cp -r "$DATA_DIR" "$DIST/data"; fi
  echo "dist ready in $DIST ($(du -sh "$DIST" | cut -f1))"
fi
echo "web/ ready: serve it with  node tools/dev-server.mjs"
