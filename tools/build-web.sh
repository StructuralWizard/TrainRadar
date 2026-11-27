#!/usr/bin/env bash
# Build the static site in web/: WebAssembly engine + vendored MapLibre.
# Reference data (web/data) comes from refdata-build (see docs/refdata.md).
#   RT_BASE=https://proxy.example/ [LIVE_BASE=https://live.example] tools/build-web.sh
# Android app (phase C4, app/): TARGET=android DIST=app/www … tools/build-web.sh
#   sets CONFIG.platform = "android" in the copy. For the app's tests,
#   RT_FIXTURES=dir bundles fixture feeds and reads them from the APK.
set -euo pipefail
cd "$(dirname "$0")/.."

tools/build-wasm.sh
(cd web && npm ci --no-audit --no-fund --silent)
mkdir -p web/vendor/maplibre
cp web/node_modules/maplibre-gl/dist/{maplibre-gl.mjs,maplibre-gl-worker.mjs,maplibre-gl.css} \
  web/node_modules/maplibre-gl/LICENSE.txt web/vendor/maplibre/
# Inter (SIL Open Font License), served from the site: no font host sees the visitors.
mkdir -p web/vendor/inter
cp web/node_modules/@fontsource-variable/inter/files/inter-{latin,latin-ext}-wght-normal.woff2 \
  web/node_modules/@fontsource-variable/inter/LICENSE web/vendor/inter/

if [ -n "${RT_BASE:-}" ]; then
  # Production: point the app and its CSP at the deployed feed sources.
  #   RT_BASE    the pass-through Worker (fallback, or the only source)
  #   LIVE_BASE  the central poller's public URL (bucket custom domain); empty
  #              keeps the app on the pass-through only.
  #   API_BASE   the public history API (e.g. https://api.example); empty
  #              hides the history teaser.
  #   REMOTE_DATA the site's data/ (Android app): newer timetables than the
  #              copy in the app, downloaded when the app starts.
  origins=$(printf '%s' "$RT_BASE" | sed -E 's#^(https://[^/]+).*#\1#')
  live=""
  api=""
  if [ -n "${API_BASE:-}" ]; then
    api="${API_BASE%/}/"
    origins="$origins $(printf '%s' "$API_BASE" | sed -E 's#^(https://[^/]+).*#\1#')"
  fi
  if [ -n "${LIVE_BASE:-}" ]; then
    live="${LIVE_BASE%/}/rt/"
    origins="$origins $(printf '%s' "$LIVE_BASE" | sed -E 's#^(https://[^/]+).*#\1#')"
  fi
  if [ -n "${REMOTE_DATA:-}" ]; then
    case "$REMOTE_DATA" in https://*/) ;; *) echo "REMOTE_DATA must be https://…/" >&2; exit 1 ;; esac
    origins="$origins $(printf '%s' "$REMOTE_DATA" | sed -E 's#^(https://[^/]+).*#\1#')"
    sed -i "s#remoteDataBase: \"\"#remoteDataBase: \"$REMOTE_DATA\"#" web/js/config.js
    grep -q "remoteDataBase: \"$REMOTE_DATA\"" web/js/config.js || { echo "remoteDataBase not set" >&2; exit 1; }
  fi
  sed -i "s#rtBase: \"/rt/\"#rtBase: \"$RT_BASE\"#; s#liveBase: \"/rt/\"#liveBase: \"$live\"#; s#apiBase: \"/\"#apiBase: \"$api\"#" web/js/config.js
  origins=$(for o in $origins; do case "$o" in https://*) printf '%s ' "$o";; esac; done)
  sed -i "s#connect-src 'self' https://tiles.openfreemap.org#connect-src 'self' https://tiles.openfreemap.org $origins#" web/index.html
  # The app must be able to reach every source it's configured with.
  for o in $origins; do
    grep -q "connect-src[^;]*$o" web/index.html || { echo "CSP lacks $o" >&2; exit 1; }
  done
  grep -q "liveBase: \"$live\"" web/js/config.js || { echo "liveBase not set" >&2; exit 1; }
  grep -q "apiBase: \"$api\"" web/js/config.js || { echo "apiBase not set" >&2; exit 1; }
fi
# DIST=dir [DATA_DIR=dir] [VERSION=id]: assemble a deployable copy without
# node_modules, with reference data and a versioned service worker.
if [ -n "${DIST:-}" ]; then
  rm -rf "$DIST" && mkdir -p "$DIST"
  cp -r web/index.html web/main.js web/app.css web/icon.svg web/icons web/js web/pkg web/vendor web/legal \
    web/manifest.webmanifest web/sw.js web/_headers web/countries.geojson web/areas.json "$DIST"/
  # Search engines and AI assistants: crawl files, guide pages (static text,
  # no scripts) and the link preview image. docs/seo.md.
  cp -r web/robots.txt web/sitemap.xml web/llms.txt web/404.html web/og-image.jpg web/guides.css \
    web/retrasos-trenes-renfe web/indemnizacion-retrasos-renfe web/separacion-entre-trenes \
    web/registrar-viajes-tren web/historico-trenes-renfe web/en "$DIST"/
  # IndexNow key file (public by design: it proves the site owns the key).
  cp web/[0-9a-f]*[0-9a-f].txt "$DIST"/
  rm -f "$DIST"/js/*.test.mjs "$DIST"/pkg/.gitignore "$DIST"/pkg/.gitkeep
  sed -i "s#const VERSION = \"dev\";#const VERSION = \"${VERSION:-$(date +%s)}\";#" "$DIST/sw.js"
  if [ -n "${DATA_DIR:-}" ]; then cp -r "$DATA_DIR" "$DIST/data"; fi
  if [ -n "${APP_VERSION:-}" ]; then
    case "$APP_VERSION" in *[!0-9A-Za-z.-]*) echo "bad APP_VERSION" >&2; exit 1 ;; esac
    sed -i "s#appVersion: \"dev\"#appVersion: \"$APP_VERSION\"#" "$DIST/js/config.js"
  fi
  if [ "${TARGET:-web}" = "android" ]; then
    # In the app the files are on the phone: no service worker, no Pages
    # headers; the coffee link never shows (Play rules on external payments).
    rm -f "$DIST/sw.js" "$DIST/_headers"
    # Nor the website's crawl files and guide pages.
    rm -rf "$DIST"/robots.txt "$DIST"/sitemap.xml "$DIST"/llms.txt "$DIST"/404.html "$DIST"/og-image.jpg \
      "$DIST"/guides.css "$DIST"/retrasos-trenes-renfe "$DIST"/indemnizacion-retrasos-renfe "$DIST"/en \
      "$DIST"/separacion-entre-trenes "$DIST"/registrar-viajes-tren "$DIST"/historico-trenes-renfe "$DIST"/[0-9a-f]*[0-9a-f].txt
    sed -i 's#platform: "web"#platform: "android"#; s#coffeeUrl: "[^"]*"#coffeeUrl: ""#' "$DIST/js/config.js"
    grep -q 'platform: "android"' "$DIST/js/config.js" || { echo "platform not set" >&2; exit 1; }
    # Countries still being built stay out of the app, even from a link.
    sed -i 's#hiddenCountries: \[[^]]*\]#hiddenCountries: []#' "$DIST/js/config.js"
    grep -q 'hiddenCountries: \[\]' "$DIST/js/config.js" || { echo "hiddenCountries not cleared" >&2; exit 1; }
    # The UK (plan 3) is in the app from 3.0; UK_APP=false builds Spain only.
    if [ "${UK_APP:-true}" = "false" ]; then
      sed -i 's#countries: \["es", "uk"[^]]*\]#countries: ["es"]#' "$DIST/js/config.js"
      grep -q 'countries: \["es"\]' "$DIST/js/config.js" || { echo "countries not set" >&2; exit 1; }
    fi
  fi
  if [ -n "${RT_FIXTURES:-}" ]; then
    # Test builds: feeds from bundled fixtures, polled like the pass-through;
    # the history API at "/" (absent in the APK: the teaser just stays hidden;
    # the browser test answers it).
    mkdir -p "$DIST/rt" && cp "$RT_FIXTURES"/*.pb "$DIST/rt/"
    # The UK's feeds (tools/demo-uk.sh), where the app reads them: uk/rt/.
    if [ -d "$RT_FIXTURES/uk" ]; then mkdir -p "$DIST/uk/rt" && cp "$RT_FIXTURES"/uk/* "$DIST/uk/rt/"; fi
    sed -i 's#liveBase: "[^"]*"#liveBase: ""#; s#rtBase: "[^"]*"#rtBase: "rt/"#; s#apiBase: "[^"]*"#apiBase: "/"#; s#replayBase: "[^"]*"#replayBase: "/"#' "$DIST/js/config.js"
    # The Android smoke test (Espresso-web) reads the page with injected
    # scripts, which need eval. Test builds only: real builds keep the CSP.
    sed -i "s#script-src 'self' 'wasm-unsafe-eval'#script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'#" "$DIST/index.html"
    grep -q "'unsafe-eval'" "$DIST/index.html" || { echo "test CSP not set" >&2; exit 1; }
  fi
  echo "dist ready in $DIST ($(du -sh "$DIST" | cut -f1))"
fi
echo "web/ ready: serve it with  node tools/dev-server.mjs"
