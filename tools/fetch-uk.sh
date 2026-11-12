#!/usr/bin/env bash
# Download the UK sources for the reference data (plan 3, phase 3b) into
# gtfs/uk/ (gitignored):
#   schedule.json.gz  Network Rail SCHEDULE, full daily extract (needs the
#                     login: NETWORK_RAIL_USERNAME / NETWORK_RAIL_PASSWORD)
#   naptan.csv        NaPTAN stops (public; rail stations give coordinates)
#   rail.geojsonseq   OpenStreetMap track in Great Britain (needs osmium-tool;
#                     skipped with --no-osm)
# Network Rail and NaPTAN data: Open Government Licence v3.0. OSM: ODbL 1.0.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p gtfs/uk
osm=1
[ "${1:-}" = "--no-osm" ] && osm=0

: "${NETWORK_RAIL_USERNAME:?set NETWORK_RAIL_USERNAME (a secret)}"
: "${NETWORK_RAIL_PASSWORD:?set NETWORK_RAIL_PASSWORD (a secret)}"

start=$SECONDS
# The login goes to curl on stdin (--config -), never on the command line or
# in a URL. Network Rail answers with a redirect to a signed download URL;
# curl doesn't send the login to the other host.
esc() { local s=${1//\\/\\\\}; printf '%s' "${s//\"/\\\"}"; } # for curl's config syntax
printf 'user = "%s:%s"\n' "$(esc "$NETWORK_RAIL_USERNAME")" "$(esc "$NETWORK_RAIL_PASSWORD")" |
  curl -fsSL --retry 4 --retry-delay 15 --config - -o gtfs/uk/schedule.json.gz.part \
    "https://publicdatafeeds.networkrail.co.uk/ntrod/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full"
mv gtfs/uk/schedule.json.gz.part gtfs/uk/schedule.json.gz
echo "schedule.json.gz: $(du -h gtfs/uk/schedule.json.gz | cut -f1) in $((SECONDS - start)) s"

start=$SECONDS
curl -fsSL --retry 4 --retry-delay 15 -o gtfs/uk/naptan.csv.part \
  "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv"
mv gtfs/uk/naptan.csv.part gtfs/uk/naptan.csv
echo "naptan.csv: $(du -h gtfs/uk/naptan.csv | cut -f1), $(grep -c ',RLY,' gtfs/uk/naptan.csv || true) rail rows, in $((SECONDS - start)) s"

if [ "$osm" = 1 ] && [ ! -s gtfs/uk/rail.geojsonseq ]; then
  start=$SECONDS
  parts=()
  for region in england scotland wales; do
    out="gtfs/uk/$region.osm.pbf"
    curl -fsSL --retry 4 --retry-delay 10 --speed-limit 100000 --speed-time 60 -o "$out" \
      "https://download.geofabrik.de/europe/united-kingdom/$region-latest.osm.pbf"
    osmium tags-filter --overwrite -o "gtfs/uk/$region-rail.osm.pbf" "$out" w/railway=rail,narrow_gauge,disused
    rm "$out"
    parts+=("gtfs/uk/$region-rail.osm.pbf")
  done
  osmium merge --overwrite -o gtfs/uk/rail.osm.pbf "${parts[@]}"
  osmium export --overwrite -f geojsonseq --geometry-types=linestring \
    -o gtfs/uk/rail.geojsonseq.part gtfs/uk/rail.osm.pbf
  mv gtfs/uk/rail.geojsonseq.part gtfs/uk/rail.geojsonseq
  echo "rail.geojsonseq: $(wc -l <gtfs/uk/rail.geojsonseq) ways, $(du -h gtfs/uk/rail.geojsonseq | cut -f1), in $((SECONDS - start)) s"
fi
