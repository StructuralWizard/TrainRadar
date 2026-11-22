#!/usr/bin/env bash
# Download an M2 country's sources for the reference data into gtfs/<cc>/
# (gitignored):  tools/fetch-eu.sh fi|no|nl|sk|ee|ch|se|pl [--no-osm]
#   gtfs.zip          the country's trains in one GTFS:
#                     fi  Digitraffic's (Fintraffic), CC BY 4.0, daily,
#                         platforms merged into stations
#                     no  Entur's rail operators (Vy, Go-Ahead Nordic,
#                         SJ Norge, Flytoget), NLOD, daily, merged and
#                         cut to trains by tools/gtfs-rail.py
#                     nl  OVapi's national GTFS (CC0 timetables, ODbL
#                         shapes), about 280 MB, cut to trains likewise
#                     sk  ŽSR's GTFS on data.slovensko.sk (CC BY), for the
#                         timetable year
#                     ee  Elron's GTFS from the public transport register
#                         (Ministry of Regional Affairs and Agriculture)
#                     ch  opentransportdata.swiss's GTFS for the timetable
#                         year (about 300 MB, no key), cut to trains
#                     se  Trafiklab's GTFS Sweden 3 (CC0), cut to trains;
#                         needs SE_TRAFIKLAB_STATIC_KEY
#                     pl  PKP PLK's schedules as GTFS (tools/plk-gtfs.py);
#                         needs PL_PLK_API_KEY
#   sources.tsv       name, url, etag, last-modified (for the manifest)
#   rail.geojsonseq   the country's OpenStreetMap track (needs osmium-tool;
#                     skipped with --no-osm)
# Clients name themselves in a header: a generic name. Keys (Sweden,
# Poland) come from the environment and are never printed or written: the
# URLs in sources.tsv (which the manifest publishes) are without them.
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

getkey() { # name url-without-key out key — the key in the URL only for curl,
  # through its config on stdin (not the command line, not sources.tsv).
  local headers
  headers=$(mktemp)
  printf 'url = "%s?key=%s"\n' "$2" "$4" | curl -fsSL --retry 4 --retry-delay 15 --compressed -D "$headers" \
    -A "$client (+https://mytrainradar.com)" -o "$3.part" -K -
  mv "$3.part" "$3"
  local modified
  modified=$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)
  rm -f "$headers"
  printf '%s\t%s\t\t%s\n' "$1" "$2" "$modified" >>"$dir/sources.tsv"
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
  sk)
    # The national catalogue's download address for ŽSR's dataset
    # ("Grafikon vlakovej dopravy vo formáte GTFS").
    get "ŽSR (data.slovensko.sk)" "https://data.slovensko.sk/download?id=556da5af-9e8a-4674-95f8-d0005299fe90" "$dir/gtfs.zip"
    region=slovakia ;;
  ee)
    get "Elron (public transport register)" https://eu-gtfs.remix.com/elron.zip "$dir/gtfs.zip"
    region=estonia ;;
  ch)
    # One GTFS per timetable year (mid-December to mid-December): from
    # 6 December, next year's, so the week ahead is in it.
    year=$(date -u +%Y)
    [ "$(date -u +%m%d)" -ge 1206 ] && year=$((year + 1))
    get "opentransportdata.swiss (timetable $year)" \
      "https://data.opentransportdata.swiss/dataset/timetable-$year-gtfs2020/permalink" "$dir/all.zip"
    # Its stops are platforms (8503000:0:3): merged into their station.
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=switzerland ;;
  se)
    [ -n "${SE_TRAFIKLAB_STATIC_KEY:-}" ] || { echo "SE_TRAFIKLAB_STATIC_KEY is not set" >&2; exit 2; }
    getkey "Samtrafiken (Trafiklab, GTFS Sweden 3)" https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip \
      "$dir/all.zip" "$SE_TRAFIKLAB_STATIC_KEY"
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=sweden ;;
  pl)
    [ -n "${PL_PLK_API_KEY:-}" ] || { echo "PL_PLK_API_KEY is not set" >&2; exit 2; }
    python3 -I tools/plk-gtfs.py "$dir/gtfs.zip"
    printf '%s\t%s\t\t%s\n' "PKP PLK (Otwarte Dane Kolejowe)" https://pdp-api.plk-sa.pl/api/v1/schedules \
      "$(date -u '+%a, %d %b %Y %H:%M:%S GMT')" >>"$dir/sources.tsv"
    region=poland ;;
  *) echo "usage: $0 fi|no|nl|sk|ee|ch|se|pl [--no-osm]" >&2; exit 2 ;;
esac

if [ "$osm" = 1 ] && [ ! -s "$dir/rail.geojsonseq" ]; then
  start=$SECONDS
  out="$dir/$region.osm.pbf"
  url="https://download.geofabrik.de/europe/$region-latest.osm.pbf"
  curl -fsSL --retry 6 --retry-delay 20 --retry-all-errors --speed-limit 100000 --speed-time 60 -o "$out" "$url" ||
    { echo "::warning::OSM: $url failed: built without the track this time (straight lines)." >&2; rm -f "$out"; exit 0; }
  osmium tags-filter --overwrite -o "$dir/rail.osm.pbf" "$out" w/railway=rail,narrow_gauge,disused
  rm "$out"
  osmium export --overwrite -f geojsonseq --geometry-types=linestring \
    -o "$dir/rail.geojsonseq.part" "$dir/rail.osm.pbf"
  mv "$dir/rail.geojsonseq.part" "$dir/rail.geojsonseq"
  echo "rail.geojsonseq: $(wc -l <"$dir/rail.geojsonseq") ways, in $((SECONDS - start)) s"
fi
