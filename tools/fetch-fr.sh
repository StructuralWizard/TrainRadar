#!/usr/bin/env bash
# Download France's sources for the reference data (docs/europe/fr.md) into
# gtfs/fr/ (gitignored):
#   sncf.zip          SNCF's combined GTFS (TGV INOUI, OUIGO, Intercités,
#                     TER, Lyria, ICE), rebuilt daily around 21:00 UTC; its
#                     trip ids are the live feed's ("NewTripId" export)
#   sources.tsv       name, url, etag, last-modified (for the manifest)
#   rail.geojsonseq   OpenStreetMap track in France (needs osmium-tool;
#                     skipped with --no-osm). Geofabrik's France extract is
#                     about 5 GB: the deploy caches the filtered track weekly.
# SNCF's data: ODbL 1.0 (transport.data.gouv.fr, dataset "horaires-sncf").
# OSM: ODbL 1.0. No key or login needed.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p gtfs/fr
osm=1
[ "${1:-}" = "--no-osm" ] && osm=0

url="https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip"
headers=$(mktemp)
curl -fsSL --retry 4 --retry-delay 15 -D "$headers" -o gtfs/fr/sncf.zip.part "$url"
mv gtfs/fr/sncf.zip.part gtfs/fr/sncf.zip
etag=$(grep -i '^etag:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r"' || true)
modified=$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)
rm -f "$headers"
printf 'SNCF (transport.data.gouv.fr)\t%s\t%s\t%s\n' "$url" "$etag" "$modified" >gtfs/fr/sources.tsv
echo "sncf.zip: $(du -h gtfs/fr/sncf.zip | cut -f1), last modified ${modified:-unknown}"

if [ "$osm" = 1 ] && [ ! -s gtfs/fr/rail.geojsonseq ]; then
  start=$SECONDS
  out="gtfs/fr/france.osm.pbf"
  url="https://download.geofabrik.de/europe/france-latest.osm.pbf"
  curl -fsSL --retry 4 --retry-delay 10 --speed-limit 100000 --speed-time 60 -o "$out" "$url" ||
    { echo "OSM: $url failed" >&2; exit 1; }
  osmium tags-filter --overwrite -o gtfs/fr/rail.osm.pbf "$out" w/railway=rail,narrow_gauge,disused
  rm "$out"
  osmium export --overwrite -f geojsonseq --geometry-types=linestring \
    -o gtfs/fr/rail.geojsonseq.part gtfs/fr/rail.osm.pbf
  mv gtfs/fr/rail.geojsonseq.part gtfs/fr/rail.geojsonseq
  echo "rail.geojsonseq: $(wc -l <gtfs/fr/rail.geojsonseq) ways, $(du -h gtfs/fr/rail.geojsonseq | cut -f1), in $((SECONDS - start)) s"
fi
