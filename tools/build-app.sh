#!/usr/bin/env bash
# Build the Android app's web bundle with the deployed site's reference data
# and the live feeds, then copy it into the Android project (app/android).
# Used by CI (try-out APK) and by the maintainer for release builds
# (docs/android.md).
#   LIVE_BASE=https://live.example API_BASE=https://api.example tools/build-app.sh
#   [SITE=https://trainradar.pages.dev]
set -euo pipefail
cd "$(dirname "$0")/.."
: "${LIVE_BASE:?set LIVE_BASE to the public URL of the live bucket}"
SITE="${SITE:-https://trainradar.pages.dev}"

data=build/app-data
rm -rf "$data" && mkdir -p "$data"
curl -fsS "$SITE/data/manifest.json" -o "$data/manifest.json"
for f in $(jq -r '.stations.file, (.regions[] | .file, (.geometry.file // empty))' "$data/manifest.json"); do
  case "$f" in *[!A-Za-z0-9._-]*) echo "odd file name in the manifest: $f" >&2; exit 1 ;; esac
  curl -fsS "$SITE/data/$f" -o "$data/$f"
done
echo "reference data: $(du -sh "$data" | cut -f1) from $SITE"

rm -rf app/www
# The bucket also serves each feed on its own: the app's fallback source
# (the pass-through Worker only answers the website).
RT_BASE="${LIVE_BASE%/}/rt/" LIVE_BASE="$LIVE_BASE" API_BASE="${API_BASE:-}" \
  TARGET=android DIST=app/www DATA_DIR="$data" tools/build-web.sh
(cd app && npm ci --no-audit --no-fund && npx cap sync android)
echo "app/android ready: cd app/android && ./gradlew assembleDebug (or bundleRelease)"
