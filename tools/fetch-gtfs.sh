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
# Station points of Renfe's long-distance live map: the track network anchors
# each one onto the right kind of track (AV, Iberian or metre gauge).
fetch "Renfe estaciones (visor LD)" https://tiempo-real.largorecorrido.renfe.com/data/estaciones.geojson estaciones.geojson

# OUIGO publishes only its timetable, on the National Access Point (NAP,
# MITRAMS). Needs a free NAP API key in $NAP_API_KEY; skipped without it.
# Licence: https://nap.transportes.gob.es/licencia-datos ("Powered by MITRAMS").
if [ -n "${NAP_API_KEY:-}" ]; then
  nap=https://nap.transportes.gob.es/api
  if curl -fsSL --retry 3 -H "ApiKey: $NAP_API_KEY" -o gtfs/ouigo.zip "$nap/Fichero/download/1766"; then
    updated=$(curl -fsSL --retry 3 -H "ApiKey: $NAP_API_KEY" -H "Accept: application/json" "$nap/Fichero/1515" \
      | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((f.get('fechaActualizacion') or '' for f in d.get('ficherosDto',[]) if f.get('ficheroId')==1766),''))" || true)
    printf '%s\t%s\t%s\t%s\n' "OUIGO GTFS (NAP, Powered by MITRAMS)" \
      "https://nap.transportes.gob.es/ConjuntoDato/Detail/1515" "" "$updated" >>gtfs/sources.tsv
    printf -- '- OUIGO (NAP): %s bytes, updated %s\n' "$(wc -c <gtfs/ouigo.zip)" "$updated"
  else
    echo "- OUIGO (NAP): download failed, building without it"
    rm -f gtfs/ouigo.zip
  fi
else
  echo "- OUIGO (NAP): no NAP_API_KEY, skipped"
fi
