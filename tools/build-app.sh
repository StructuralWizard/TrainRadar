#!/usr/bin/env bash
# Build the Android app's web bundle with the deployed site's reference data
# and the live feeds, then copy it into the Android project (app/android).
# Used by CI (try-out APK) and by the maintainer for release builds
# (docs/android.md).
#   LIVE_BASE=https://live.example API_BASE=https://api.example tools/build-app.sh
#   [SITE=https://trainradar.pages.dev] [APP_VERSION=2.0.0]
set -euo pipefail
cd "$(dirname "$0")/.."
: "${LIVE_BASE:?set LIVE_BASE to the public URL of the live bucket}"
SITE="${SITE:-https://trainradar.pages.dev}"

data=build/app-data
rm -rf "$data" && mkdir -p "$data"
curl -fsS "$SITE/data/manifest.json" -o "$data/manifest.json"
for f in $(jq -r '.stations.file, (.network.file // empty), (.regions[] | .file, (.geometry.file // empty))' "$data/manifest.json"); do
  case "$f" in *[!A-Za-z0-9._-]*) echo "odd file name in the manifest: $f" >&2; exit 1 ;; esac
  curl -fsS "$SITE/data/$f" -o "$data/$f"
done
# Android's build tools unpack *.gz assets and drop the suffix, so the app
# would ask for files that aren't there. Store them unpacked under names
# without .gz, and point the manifest at those names.
for f in "$data"/*.gz; do
  [ -e "$f" ] || continue
  if [ "$(head -c 2 "$f" | od -A n -t x1 | tr -d ' ')" = "1f8b" ]; then
    gzip -dc "$f" > "${f%.gz}" && rm "$f"
  else
    mv "$f" "${f%.gz}"
  fi
done
jq '(.. | objects | select(has("file")) | .file) |= sub("\\.gz$"; "")' "$data/manifest.json" > "$data/m.json"
mv "$data/m.json" "$data/manifest.json"
for f in $(jq -r '.stations.file, (.network.file // empty), (.regions[] | .file, (.geometry.file // empty))' "$data/manifest.json"); do
  [ -f "$data/$f" ] || { echo "manifest names $f, which isn't in $data" >&2; exit 1; }
done
if ls "$data" | grep -q '\.gz$'; then echo "gzip files left in $data" >&2; exit 1; fi
echo "reference data: $(du -sh "$data" | cut -f1) from $SITE"

rm -rf app/www
# The bucket also serves each feed on its own: the app's fallback source
# (the pass-through Worker only answers the website).
RT_BASE="${LIVE_BASE%/}/rt/" LIVE_BASE="$LIVE_BASE" API_BASE="${API_BASE:-}" \
  APP_VERSION="${APP_VERSION:-}" TARGET=android DIST=app/www DATA_DIR="$data" tools/build-web.sh
(cd app && npm ci --no-audit --no-fund && npx cap sync android)
echo "app/android ready: cd app/android && ./gradlew assembleDebug (or bundleRelease)"
