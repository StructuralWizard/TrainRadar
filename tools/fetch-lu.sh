#!/usr/bin/env bash
# Download Luxembourg's sources for the reference data
# (docs/europe/west-central.md) into gtfs/lu/ (gitignored):
#   gtfs.zip          the Administration des transports publics' national
#                     GTFS (every mode; the build keeps the trains), new
#                     every week on data.public.lu
#   sources.tsv       name, url, etag, last-modified (for the manifest)
#   rail.geojsonseq   OpenStreetMap track in Luxembourg (needs osmium-tool;
#                     skipped with --no-osm)
# The GTFS: CC BY 4.0. OSM: ODbL 1.0. No key or login needed.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p gtfs/lu
osm=1
[ "${1:-}" = "--no-osm" ] && osm=0

# Each week's file has its own address: ask data.public.lu for the newest.
dataset="https://data.public.lu/api/1/datasets/5a2a58b9111e9b7f34fc6606/"
url=$(curl -fsSL --retry 4 --retry-delay 15 "$dataset" |
  jq -r '[.resources[] | select(.format == "zip")] | sort_by(.last_modified) | last | .url')
case "$url" in https://*) ;; *) echo "no GTFS in $dataset" >&2; exit 1 ;; esac
headers=$(mktemp)
curl -fsSL --retry 4 --retry-delay 15 -D "$headers" -o gtfs/lu/gtfs.zip.part "$url"
mv gtfs/lu/gtfs.zip.part gtfs/lu/gtfs.zip
etag=$(grep -i '^etag:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r"' || true)
modified=$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)
rm -f "$headers"
printf 'Administration des transports publics (data.public.lu)\t%s\t%s\t%s\n' "$url" "$etag" "$modified" >gtfs/lu/sources.tsv
echo "gtfs.zip: $(du -h gtfs/lu/gtfs.zip | cut -f1), $(basename "$url")"

if [ "$osm" = 1 ] && [ ! -s gtfs/lu/rail.geojsonseq ]; then
  out="gtfs/lu/luxembourg.osm.pbf"
  url="https://download.geofabrik.de/europe/luxembourg-latest.osm.pbf"
  curl -fsSL --retry 4 --retry-delay 10 -o "$out" "$url" || { echo "OSM: $url failed" >&2; exit 1; }
  osmium tags-filter --overwrite -o gtfs/lu/rail.osm.pbf "$out" w/railway=rail,narrow_gauge,disused
  rm "$out"
  osmium export --overwrite -f geojsonseq --geometry-types=linestring \
    -o gtfs/lu/rail.geojsonseq.part gtfs/lu/rail.osm.pbf
  mv gtfs/lu/rail.geojsonseq.part gtfs/lu/rail.geojsonseq
  echo "rail.geojsonseq: $(wc -l <gtfs/lu/rail.geojsonseq) ways"
fi
