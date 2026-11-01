#!/usr/bin/env bash
# Download Renfe static data into ./gtfs (gitignored). URLs are the ones
# approved in docs/data-sources.md. Prints source validators for change detection.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p gtfs
fetch() {
  local url=$1 out=$2
  curl -fsSL --retry 4 --retry-delay 5 -D "gtfs/$out.headers" -o "gtfs/$out" "$url"
  printf '%s  %s  %s\n' "$out" "$(grep -i '^etag:' "gtfs/$out.headers" | tr -d '\r' | cut -d' ' -f2-)" \
    "$(grep -i '^last-modified:' "gtfs/$out.headers" | tr -d '\r' | cut -d' ' -f2-)"
}
fetch https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip ld.zip
fetch https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip cercanias.zip
fetch https://ssl.renfe.com/ftransit/Fichero_estaciones/estaciones.csv estaciones.csv
