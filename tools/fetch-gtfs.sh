#!/usr/bin/env bash
# Download Renfe static data into ./gtfs (gitignored). URLs are the ones
# approved in docs/data-sources.md. Writes gtfs/sources.tsv (name, url, ETag,
# Last-Modified) for the manifest and for change detection.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p gtfs
: >gtfs/sources.tsv
fetch() {
  local name=$1 url=$2 out=$3
  curl -fsSL --retry 4 --retry-delay 5 -D "gtfs/$out.headers" -o "gtfs/$out" "$url"
  local etag lm
  etag=$(grep -i '^etag:' "gtfs/$out.headers" | tail -1 | cut -d' ' -f2- | tr -d '\r"' || true)
  lm=$(grep -i '^last-modified:' "gtfs/$out.headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)
  printf '%s\t%s\t%s\t%s\n' "$name" "$url" "$etag" "$lm" >>gtfs/sources.tsv
  printf -- '- %s: %s bytes, ETag %s, Last-Modified %s\n' "$name" "$(wc -c <"gtfs/$out")" "$etag" "$lm"
}
fetch "Renfe AV/LD/MD GTFS" https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip ld.zip
fetch "Renfe Cercanías GTFS" https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip cercanias.zip
