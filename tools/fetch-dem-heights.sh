#!/usr/bin/env bash
# Terrain height of every OpenStreetMap rail node, from the Copernicus DEM
# GLO-30 (public AWS bucket, no key): gtfs/rail-heights.txt (gitignored).
# Downloads only the 1°×1° tiles with rail in them (~40 MB each), samples
# them, then deletes them. Needs gtfs/rail.geojsonseq (tools/fetch-osm-rail.sh)
# and a release build of refdata-build.
#
# Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus
# Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European
# Union and ESA; all rights reserved.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=${REFDATA_BUILD:-target/release/refdata-build}
RAIL=${RAIL:-gtfs/rail.geojsonseq}
OUT=${OUT:-gtfs/rail-heights.txt}
DIR=gtfs/dem
mkdir -p "$DIR"
"$BIN" dem-tiles --rail "$RAIL" >"$DIR/tiles.txt"
echo "DEM: $(wc -l <"$DIR/tiles.txt") tiles"
# Tiles over the sea don't exist (404): skip them.
xargs -P 6 -n 1 sh -c 'curl -fsSL --retry 4 --retry-delay 5 -o "$0/$(basename "$1")" "$1" || echo "no tile: $1"' "$DIR" <"$DIR/tiles.txt"
"$BIN" dem-sample --rail "$RAIL" --dem "$DIR" --out "$OUT"
rm -rf "$DIR"
echo "$OUT: $(wc -l <"$OUT") nodes, $(du -h "$OUT" | cut -f1)"
