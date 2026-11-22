#!/usr/bin/env bash
# Download Ireland's sources for the reference data (docs/europe/ie.md) into
# gtfs/ie/ (gitignored):
#   GTFS_Irish_Rail.zip  Iarnród Éireann's timetable, from the National
#                        Transport Authority (Transport for Ireland), rebuilt
#                        daily; its trip ids are the live feed's
#   sources.tsv          name, url, etag, last-modified (for the manifest)
#   rail.geojsonseq      OpenStreetMap track in Ireland and Northern Ireland
#                        (needs osmium-tool; skipped with --no-osm)
# The NTA's data: CC BY 4.0, provided as is (developer.nationaltransport.ie).
# OSM: ODbL 1.0. No key or login needed.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p gtfs/ie
osm=1
[ "${1:-}" = "--no-osm" ] && osm=0

url="https://www.transportforireland.ie/transitData/Data/GTFS_Irish_Rail.zip"
headers=$(mktemp)
curl -fsSL --retry 4 --retry-delay 15 -D "$headers" -o gtfs/ie/GTFS_Irish_Rail.zip.part "$url"
mv gtfs/ie/GTFS_Irish_Rail.zip.part gtfs/ie/GTFS_Irish_Rail.zip
etag=$(grep -i '^etag:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r"' || true)
modified=$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)
rm -f "$headers"
printf 'Iarnród Éireann (NTA)\t%s\t%s\t%s\n' "$url" "$etag" "$modified" >gtfs/ie/sources.tsv
echo "GTFS_Irish_Rail.zip: $(du -h gtfs/ie/GTFS_Irish_Rail.zip | cut -f1), last modified ${modified:-unknown}"

if [ "$osm" = 1 ] && [ ! -s gtfs/ie/rail.geojsonseq ]; then
  start=$SECONDS
  region=ireland-and-northern-ireland
  out="gtfs/ie/$region.osm.pbf"
  url="https://download.geofabrik.de/europe/$region-latest.osm.pbf"
  curl -fsSL --retry 4 --retry-delay 10 --speed-limit 100000 --speed-time 60 -o "$out" "$url" ||
    { echo "OSM: $url failed" >&2; exit 1; }
  osmium tags-filter --overwrite -o gtfs/ie/rail.osm.pbf "$out" w/railway=rail,narrow_gauge,disused
  rm "$out"
  osmium export --overwrite -f geojsonseq --geometry-types=linestring \
    -o gtfs/ie/rail.geojsonseq.part gtfs/ie/rail.osm.pbf
  mv gtfs/ie/rail.geojsonseq.part gtfs/ie/rail.geojsonseq
  echo "rail.geojsonseq: $(wc -l <gtfs/ie/rail.geojsonseq) ways, $(du -h gtfs/ie/rail.geojsonseq | cut -f1), in $((SECONDS - start)) s"
fi
