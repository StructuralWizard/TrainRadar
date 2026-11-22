#!/usr/bin/env bash
# Download an M2 country's sources for the reference data into gtfs/<cc>/
# (gitignored):  tools/fetch-eu.sh fi|no|nl [--no-osm]
#   gtfs.zip          the country's trains in one GTFS:
#                     fi  Digitraffic's (Fintraffic), CC BY 4.0, daily,
#                         platforms merged into stations
#                     no  Entur's rail operators (Vy, Go-Ahead Nordic,
#                         SJ Norge, Flytoget), NLOD, daily, merged and
#                         cut to trains by tools/gtfs-rail.py
#                     nl  OVapi's national GTFS (CC0 timetables, ODbL
#                         shapes), about 280 MB, cut to trains likewise
#   sources.tsv       name, url, etag, last-modified (for the manifest)
#   rail.geojsonseq   the country's OpenStreetMap track (needs osmium-tool;
#                     skipped with --no-osm)
# No key or login. Clients name themselves in a header: a generic name.
set -euo pipefail
cd "$(dirname "$0")/.."
cc="${1:-}"
osm=1
[ "${2:-}" = "--no-osm" ] && osm=0
dir="gtfs/$cc"
mkdir -p "$dir"
client="Metranos-TrainRadar"
: >"$dir/sources.tsv"

get() { # name url out [header]
  local headers
  headers=$(mktemp)
  curl -fsSL --retry 4 --retry-delay 15 --compressed -D "$headers" ${4:+-H "$4"} \
    -A "$client (+https://mytrainradar.com)" -o "$3.part" "$2"
  mv "$3.part" "$3"
  local etag modified
  etag=$(grep -i '^etag:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r"' || true)
  modified=$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)
  rm -f "$headers"
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$etag" "$modified" >>"$dir/sources.tsv"
  echo "$(basename "$3"): $(du -h "$3" | cut -f1), last modified ${modified:-unknown}"
}

case "$cc" in
  fi)
    get "Fintraffic (digitraffic.fi)" https://rata.digitraffic.fi/api/v1/trains/gtfs-passenger.zip \
      "$dir/all.zip" "Digitraffic-User: $client"
    # Its stops are platforms (HKI_0…HKI_19): merged into their station.
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=finland ;;
  no)
    base=https://storage.googleapis.com/marduk-production/outbound/gtfs
    parts=()
    for op in vyg goa sjn flt; do
      get "Entur ($op)" "$base/rb_${op}-aggregated-gtfs.zip" "$dir/$op.zip"
      parts+=("$dir/$op.zip")
    done
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "${parts[@]}" --parents
    rm -f "${parts[@]}"
    region=norway ;;
  nl)
    get "OVapi (NDOV)" https://gtfs.ovapi.nl/nl/gtfs-nl.zip "$dir/all.zip"
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=netherlands ;;
  *) echo "usage: $0 fi|no|nl [--no-osm]" >&2; exit 2 ;;
esac

if [ "$osm" = 1 ] && [ ! -s "$dir/rail.geojsonseq" ]; then
  start=$SECONDS
  out="$dir/$region.osm.pbf"
  url="https://download.geofabrik.de/europe/$region-latest.osm.pbf"
  curl -fsSL --retry 4 --retry-delay 10 --speed-limit 100000 --speed-time 60 -o "$out" "$url" ||
    { echo "OSM: $url failed" >&2; exit 1; }
  osmium tags-filter --overwrite -o "$dir/rail.osm.pbf" "$out" w/railway=rail,narrow_gauge,disused
  rm "$out"
  osmium export --overwrite -f geojsonseq --geometry-types=linestring \
    -o "$dir/rail.geojsonseq.part" "$dir/rail.osm.pbf"
  mv "$dir/rail.geojsonseq.part" "$dir/rail.geojsonseq"
  echo "rail.geojsonseq: $(wc -l <"$dir/rail.geojsonseq") ways, in $((SECONDS - start)) s"
fi
