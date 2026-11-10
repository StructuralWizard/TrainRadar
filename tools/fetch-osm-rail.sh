#!/usr/bin/env bash
# Download OpenStreetMap extracts from Geofabrik and keep only railway=rail,
# railway=narrow_gauge and railway=disused ways (track in place but out of use,
# e.g. closed for works), as GeoJSON lines: gtfs/rail.geojsonseq (gitignored).
# Needs osmium-tool. OSM data © OpenStreetMap contributors, ODbL 1.0.
#
# - Spain, and Portugal for cross-border trains (e.g. Vigo–Porto).
# - The French Mediterranean corridor (Figueres–Perpignan–Montpellier–Marseille),
#   clipped from two French regional extracts to the bounding box below.
#
# Sidings, yards and abandoned track are dropped later by
# `refdata-build` (it reads every tag), so this file stays a plain extract.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p gtfs/osm
GEOFABRIK=https://download.geofabrik.de/europe
# west,south,east,north: Pyrenees border to Marseille and Avignon.
FR_CORRIDOR=2.5,42.3,5.6,44.0
parts=()

fetch() { # region path, local name
  curl -fsSL --retry 4 --retry-delay 10 -o "gtfs/osm/$2.osm.pbf" "$GEOFABRIK/$1-latest.osm.pbf"
}
keep_rail() { # local name of a .osm.pbf to filter (deleted afterwards)
  osmium tags-filter --overwrite -o "gtfs/osm/$1-rail.osm.pbf" "gtfs/osm/$1.osm.pbf" \
    w/railway=rail,narrow_gauge,disused
  rm "gtfs/osm/$1.osm.pbf"
  parts+=("gtfs/osm/$1-rail.osm.pbf")
}

for region in spain portugal; do
  fetch "$region" "$region"
  keep_rail "$region"
done
for region in languedoc-roussillon provence-alpes-cote-d-azur; do
  fetch "france/$region" "$region-full"
  osmium extract --overwrite -b "$FR_CORRIDOR" -o "gtfs/osm/$region.osm.pbf" "gtfs/osm/$region-full.osm.pbf"
  rm "gtfs/osm/$region-full.osm.pbf"
  keep_rail "$region"
done
osmium merge --overwrite -o gtfs/osm/rail.osm.pbf "${parts[@]}"
osmium export --overwrite -f geojsonseq --geometry-types=linestring \
  -o gtfs/rail.geojsonseq gtfs/osm/rail.osm.pbf
echo "rail.geojsonseq: $(wc -l <gtfs/rail.geojsonseq) ways, $(du -h gtfs/rail.geojsonseq | cut -f1)"
