# Reference data (`.bin` files)

`refdata-build` turns Renfe's static GTFS into small files the browser loads
directly. It runs in CI only. The browser never downloads raw GTFS.

```sh
tools/fetch-gtfs.sh                                   # → gtfs/ (gitignored)
cargo run --release -p trainradar-refdata-build -- build --out web/data \
  --ld gtfs/ld.zip --cercanias gtfs/cercanias.zip --sources gtfs/sources.tsv
cargo run --release -p trainradar-refdata-build -- verify web/data
cargo run --release -p trainradar-refdata-build -- inspect gtfs/ld.zip   # explore a feed
```

## Files

| File | Loaded | Contents |
|---|---|---|
| `manifest.json` | first, short cache | Format version, date window, sources (ETag, Last-Modified), file names, region bounding boxes, attribution |
| `stations.<hash>.bin` | at start | Every station (AV/LD/MD + Cercanías) with services, regions, and a spatial grid index for "nearest station" |
| `tt-ld.<hash>.bin` | at start | AV/LD/MD timetable |
| `tt-<núcleo>.<hash>.bin` | when that region is on screen | One Cercanías núcleo (10 Madrid, 51 Rodalies, …) |
| `geo-<region>.<hash>.bin` | after the timetable | OpenStreetMap track for trips without a usable GTFS shape |

Hashed names change whenever content changes, so they can be cached for a year.

## Format (v3)

All files are [postcard](https://postcard.jamesmunns.com)-encoded structs from
`crates/proto/src/refdata.rs`, starting with a header (`TRRD` magic, format
version, date window). Postcard writes integers as varints, so:

- Coordinates are integers in 1e-5° (~1.1 m).
- Shapes are delta-encoded: most points take 2–4 bytes.
- **Trip patterns:** trips with the same stops, relative times and shape share
  one pattern. A trip is then just a pattern, a start time and a day bitmask. Cercanías:
  27,563 trips → 1,403 patterns.
- **Date window:** only service days from yesterday to +6 days are kept
  (`days` bitmask per trip). Files are rebuilt daily.
- Trip ids that start with their GTFS `service_id` (all Cercanías ones) are
  stored without that prefix.
- Shapes are simplified with Douglas–Peucker at 5 m.
- For each pattern stop we store the distance along the shape, which is what
  interpolation and train spacing need.

### Shapes

| Feed | `shapes.txt` | What we do |
|---|---|---|
| Cercanías | Yes, one shape per line (e.g. `10_C1`), single direction | Stops are projected onto the shape in order. Trips running the other way use a reversed copy. 90% of patterns fit. The rest (a stop > 400 m off, or out of order) use straight segments. |
| AV/LD/MD | **No** | Routed along OpenStreetMap track (below). |

**OpenStreetMap track (approved 2026-11-01).** CI downloads the Spain,
Portugal and French-corridor extracts from Geofabrik (cached weekly), keeps
`railway=rail`, `narrow_gauge` and `disused` ways with `osmium`, and builds a
track graph where ways sharing a node connect (see the rail network below
for which ways count). Each pair of consecutive stops is routed with A*, from
the stations' anchors on the track (other stops snap within 1 km), preferring
the train's kind of track (AVE, Avlo, Avant, OUIGO: AV track; MD and
regionals: conventional; other track costs 1.5×) and keeping to running lines
(service track costs 4×). Routes more than 1.8× the straight distance + 20 km
are rejected. Each routed stop pair is stored once as a *leg*, simplified at
15 m, and shared by every trip between those stops. Pairs that can't be
routed (gaps in OSM) stay straight.

Result (build of 2026-11-10): 3,517 stop pairs follow track, 41 don't.

### Rail network (`rail.<hash>.bin`)

The map draws the whole network from OpenStreetMap, independent of the
timetable, by kind of track (`crates/refdata-build/src/railnet.rs`):

| Kind | Rule (the way's own tags) |
|---|---|
| AV | `highspeed=yes`, or 1435 mm in Spain (not FGC's Barcelona–Vallès line) |
| Conventional | 1668 mm (also third rail, flagged `mixed`), and 1435 mm in France |
| Metre gauge | 1000 mm, or `railway=narrow_gauge` with no gauge |

- Each OSM way keeps its own kind, so parallel AV and conventional track stay
  separate sections.
- Left out: abandoned/razed track, `usage=industrial|military|test`, gauges
  under 1000 mm. Disused track (`railway=disused`, e.g. closed for works) is
  kept and drawn faded.
- Service track (`service=*`: yards, sidings, crossovers) isn't drawn but
  joins lines up for routing. Where OSM maps the through line or platform
  tracks of a station as sidings (Cuenca, Alicante AV), the loose ends of a
  line within 1 km of the station (1.5 km for main ones) are joined along the
  shortest service track of the same kind, and that is drawn.
- Renfe stations (`--stations`, the live map's `estaciones.geojson`) are
  projected onto the nearest track of each kind within 300 m (600 m for main
  stations) and the parallel tracks beside it (within 50 m more, up to 4),
  falling back to the nearest track within 1 km. The track is cut there, so
  lines pass through the station's point on the track; the build report
  lists the stations that can't be projected.
- Sections run between junctions and stations, simplified at 15 m. Spain,
  Portugal and the French corridor: 7,738 sections, 328 KB raw, 236 KB gzip.

`--network-geojson FILE` also writes the network and the anchors as GeoJSON,
to check on a map.

### Validation

```sh
python3 -I tools/collect-renfe-ld.py gtfs/renfe-ld-pairs.tsv   # several times a day
cargo run --release -p trainradar-refdata-build -- validate-net \
  --rail gtfs/rail.geojsonseq --stations gtfs/estaciones.geojson \
  --pairs gtfs/renfe-ld-pairs.tsv --ld gtfs/ld.zip --report validate-net.md --csv validate-net.csv
```

For every pair of consecutive stops (live trains, and the timetable with
`--ld`) it looks for a track path between the stations' anchors and reports
the pairs with none, or with one longer than 1.5× the straight distance
(straight + 1 km for short hops). Many of those are real: mountain lines
(Pajares, Brañuelas, Canfranc, the Cantabrian metre gauge) and terminal
stations (Valencia Nord, Barcelona-França) run well over 1.5× straight. CI
adds the summary to every run.

Licence: OSM data © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/).
The `geo-*.bin` and `rail.*.bin` files are a derived database, published openly with the site
under the ODbL. Attribution is in `manifest.json`, the README and the map.

### Height profiles (gradients)

With `--rail-heights` (from `tools/fetch-dem-heights.sh`), every leg also gets
a height profile: one sample about every 400 m, stored as decimetre deltas in
`GeometryFile.profiles` (format v5).

1. `refdata-build dem-tiles` lists the Copernicus GLO-30 tiles (1°×1°, AWS open
   data, no key) that contain rail nodes; CI downloads them, `dem-sample` reads
   the height under every OSM rail node, and the tiles are deleted. The small
   result is cached weekly, like the OSM file.
2. Tunnels, bridges and covered track (OSM `tunnel`, `bridge`, `covered`): the
   DEM shows the mountain or the valley floor there, so nodes inside are
   interpolated between the two nearest ends of the structure, by distance
   along the track.
3. Each routed leg is resampled evenly and smoothed with a [1, 2, 1]
   filter. Legs where under 90 % of the points have a height get no profile.

The engine measures the gradient over 800 m centred on the train (within its
leg), positive uphill in the direction of travel. The DEM is a surface model
(it includes buildings and trees) with metre-level noise, so gradients are
approximate, good to a few ‰, and cuttings and embankments are smoothed away.
Cercanías trips on GTFS shapes have no profile yet.

## Sizes (build of 2026-11-01)

| File | Raw | gzip -9 | brotli |
|---|---:|---:|---:|
| `manifest.json` | 9.8 KB | 2.1 KB | 1.7 KB |
| `stations` (1,471 stations) | 47.3 KB | 29.4 KB | 24.6 KB |
| `tt-ld` (3,424 trips) | 303.2 KB | 106.2 KB | 85.2 KB |
| `geo-ld` (OSM track, 2,146 legs) | 418.1 KB | 263.1 KB | 178.7 KB |
| `tt-10` Madrid | 200.9 KB | 55.6 KB | 34.6 KB |
| `tt-51` Rodalies de Catalunya | 221.7 KB | 67.6 KB | 45.9 KB |
| other 13 núcleos | 7–112 KB each | 2–34 KB each | 1.6–25 KB each |
| `geo-<núcleo>` (OSM for the few Cercanías trips without a fitting shape) | 1–12 KB each | 1–8 KB each | 1–7 KB each |
| **First load** (manifest + stations + AV/LD/MD timetable) | 360 KB | **138 KB** | 111 KB |
| then AV/LD/MD track | 418 KB | 263 KB | 179 KB |

Reproduce: the "Refdata" GitHub Actions workflow prints this table on every run.

## Not used

- `estaciones.csv`: GTFS `stops.txt` already gives every station we need, with
  matching ids. We'll revisit it if we need extra fields (address, province).
- Renfe's replacement and connecting **buses** (`route_type` 3, 19,276
  Cercanías trips) are skipped: they're not trains and have no live positions.

## The UK (plan 3, phase 3b)

`build --uk-schedule FILE --naptan FILE` reads Network Rail's SCHEDULE (JSON lines,
gzipped) and NaPTAN's stops CSV instead of a GTFS feed (`crates/refdata-build/src/nrsched.rs`)
and builds one region, `uk` (Great Britain), in its own output directory:

- passenger trains only (`train_status` P or 1), calls with public times, at stations
  NaPTAN places (`ATCOCode` = `9100` + TIPLOC); with `--corpus`, a call at a TIPLOC NaPTAN
  doesn't know is placed at a station sharing its STANOX (one station, several TIPLOCs);
- for each train and day, the schedule with the highest STP priority (C cancels; N, O over P);
- trip id `UID:start date:STP` (what TRUST's activation names), short name the headcode,
  headsign the last call, route = the operator (ATOC code);
- `--rail` with Great Britain's OpenStreetMap track routes the legs, as for Renfe.

`tools/fetch-uk.sh` downloads the three inputs into `gtfs/uk/`; the "Refdata UK" workflow
(manual, main only: it needs the Network Rail login) builds and reports them.

First run on real data (2026-11-12): 724,656 schedules → 127,818 in the 8-day window →
59,994 passenger trips in 24,161 patterns at 2,623 stations; 96 % of public calls placed
(28,474 calls at 60 TIPLOCs had no NaPTAN station before the CORPUS fallback). Timetable
5.6 MB raw (about 2 MB gzipped), track 0.9 MB, stations 80 KB; 8,266 stop pairs routed on
Great Britain's OSM track, 31 drawn straight. The build takes under 20 s.
