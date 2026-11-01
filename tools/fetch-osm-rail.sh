#!/usr/bin/env bash
# Download OpenStreetMap extracts for Spain and Portugal from Geofabrik and keep
# only railway=rail ways, as GeoJSON lines: gtfs/rail.geojsonseq (gitignored).
# Needs osmium-tool. OSM data © OpenStreetMap contributors, ODbL 1.0.
# Portugal is included for cross-border trains (e.g. Vigo–Porto).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p gtfs/osm
for region in spain portugal; do
  curl -fsSL --retry 4 --retry-delay 10 -o "gtfs/osm/$region.osm.pbf" \
    "https://download.geofabrik.de/europe/$region-latest.osm.pbf"
  osmium tags-filter --overwrite -o "gtfs/osm/$region-rail.osm.pbf" \
    "gtfs/osm/$region.osm.pbf" w/railway=rail
  rm "gtfs/osm/$region.osm.pbf"
done
osmium merge --overwrite -o gtfs/osm/rail.osm.pbf gtfs/osm/spain-rail.osm.pbf gtfs/osm/portugal-rail.osm.pbf
osmium export --overwrite -f geojsonseq --geometry-types=linestring \
  -o gtfs/rail.geojsonseq gtfs/osm/rail.osm.pbf
echo "rail.geojsonseq: $(wc -l <gtfs/rail.geojsonseq) ways, $(du -h gtfs/rail.geojsonseq | cut -f1)"
