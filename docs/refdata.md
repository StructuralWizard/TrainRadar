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

Hashed names change whenever content changes, so they can be cached for a year.

## Format (v2)

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
| AV/LD/MD | **No** | Straight segments between stops (fallback). See the proposal below. |

**Proposal for AV/LD/MD geometry (needs approval):** use OpenStreetMap railway
geometry. In CI, download a Spain rail extract (`railway=rail`, ~10–20 MB),
build a track graph, and route each pair of consecutive stops along the track.
That gives real curves for the map, better interpolation, and correct km for
train spacing. Licence: OSM data is ODbL. We must show "© OpenStreetMap
contributors" and publish the derived shapes under ODbL. Since the generated
files are already public, the share-alike part is easy to meet.

## Sizes (build of 2026-11-01)

| File | Raw | gzip -9 | brotli |
|---|---:|---:|---:|
| `manifest.json` | 8.3 KB | 1.9 KB | 1.5 KB |
| `stations` (1,471 stations) | 47.3 KB | 29.4 KB | 24.5 KB |
| `tt-ld` (3,424 trips) | 269.4 KB | 97.1 KB | 77.3 KB |
| `tt-10` Madrid | 200.6 KB | 55.5 KB | 34.6 KB |
| `tt-51` Rodalies de Catalunya | 220.4 KB | 67.2 KB | 45.8 KB |
| `tt-20` Asturias | 111.4 KB | 33.5 KB | 24.6 KB |
| other 12 núcleos | 7–62 KB each | 2–19 KB each | 1.6–13 KB each |
| **Initial load** (manifest + stations + AV/LD/MD) | 325 KB | **128 KB** | 103 KB |
| **Everything** | 1.14 MB | 383 KB | 278 KB |

Reproduce: the "Refdata" GitHub Actions workflow prints this table on every run.

## Not used

- `estaciones.csv`: GTFS `stops.txt` already gives every station we need, with
  matching ids. We'll revisit it if we need extra fields (address, province).
- Renfe's replacement and connecting **buses** (`route_type` 3, 19,276
  Cercanías trips) are skipped: they're not trains and have no live positions.
