# Engine (`crates/engine`)

Runs in the browser as WebAssembly. The web app fetches feeds through the CORS
pass-through Worker, hands the bytes to the engine, and asks it what to draw.

```js
import init, { Engine, FeedPoller } from "./pkg/engine.js";
await init();
const e = new Engine();
e.loadStations(stationsBytes);
e.loadTimetable(ldBytes, Date.now());      // then each Cercanías region on demand
e.loadGeometry(ldGeoBytes);                // OSM track, after first paint
for (const f of JSON.parse(e.feedsJson())) { /* poll f.path every f.interval s */ }
e.ingest("vp_ld", pbBytes, Date.now());    // after each fetch
const pos = e.positions(Date.now());       // every frame: lon, lat, class, bearing, fix age
const info = JSON.parse(e.trainJson(i, Date.now()));  // popup, incl. spacing
```

## Pipeline

1. **Decode** GTFS-RT protobuf (`gtfs_rt.rs`: hand-written prost structs, no
   `protoc`). Renfe-specific details live in `renfe.rs` behind the
   `SourceAdapter` trait: label parsing (`C1-23537-PLATF.(3)` → line, train
   number, platform), cancellations, alert texts.
2. **Match** each vehicle to a scheduled run (`network.rs`): exact GTFS trip id
   first, then train number. Among service days (yesterday, today, tomorrow)
   it picks the run whose span (60 min early to 6 h late) contains now.
   Times use Europe/Madrid with EU daylight-saving rules (`proto/time.rs`).
3. **Merge duplicates.** The AV/LD/MD feed lists some trains once per timetable
   variant. Same number within 500 m → keep the best-matched entry.
4. **Delay.** Renfe's trip-update delay if present (99% of trains). Otherwise
   estimated from where the GPS fix is versus where the timetable says the
   train should be.
5. **Position.** The GPS fix is projected onto the trip's own section of track.
   Between fixes the train advances by as much as the schedule says it should
   have moved since the fix, shifted by the delay (`schedule.rs`). It waits
   at stops for its dwell time, never goes backwards, and never passes the
   terminus. Fresh fixes (≤ 45 s) are shown as-is.
6. **Fix age.** The feed timestamp if it has one (Cercanías). AV/LD/MD positions
   have none, so the age counts from when that train's position last changed.
7. **Spacing** (`spacing.rs`). Train L is ahead of F if the track section L is
   on (previous stop → next stop) appears later in F's route, in the same
   direction. Distance is measured along F's track. Time is when F should
   reach L's current position (F's schedule + delay). This works across lines
   that share track, and across AV/LD/MD and Cercanías.
8. **Polling** (`poll.rs`): 30 s per feed (the server's own `max-age`), alerts
   every 2 min, +0–10% jitter (never faster), exponential backoff to 10 min
   on errors, and no polling while the tab is hidden.

## Location features (only after "Use my location")

- **Nearest stations:** the grid spatial index in `stations.bin` (`places.rs`).
- **Station board:** every trip in the loaded timetables that calls at the
  station in the next 90 min, in timetable order, with Renfe's live delay
  (or the delay of the matching train on the map), cancellations, and
  arrivals for trains that terminate there. Turning location on loads the
  Cercanías núcleo around you first.
- **Approaching trains:** trains on the map whose remaining stops include
  the station, with ETA (schedule + delay) and distance along the track.
- **"Am I on this train?"** (`onboard.rs`). Every fix is compared with the
  trains within 3 km at that moment. A train is a match when, over a
  30–90 s window with ≥ 3 fixes:
  - it was near ≥ 80% of the fixes;
  - its median distance is within max(300 m, 2 × GPS accuracy);
  - its speed is within 35% (or 3 m/s) of yours. Speeds are medians between
    consecutive fixes, so one bad fix doesn't spoil them.

  The user must be moving at ≥ 15 km/h; otherwise the answer is "standing still,
  can't tell". One fit over ≥ 45 s and ≥ 4 fixes is **high** confidence; one
  fit sooner, or a clear winner among several, is **medium**; close
  alternatives are reported as ambiguous. It never assumes.
- **Privacy:** fixes live only in page memory, are dropped after 90 s, and
  are cleared when location is turned off. `watchPosition` runs only while
  location is on and the tab is visible. Nothing is sent, logged or stored.

## Live results (CI "Refdata" run, 1 Nov 2026 ~19:15 Madrid)

`cargo run --release -p trainradar-engine --example live_check -- web/data gtfs/rt`

| | Cercanías | AV/LD/MD |
|---|---:|---:|
| Trains in feed (after merging duplicates) | 299 | 157 |
| Matched to a timetable trip | 295 (99%) | 156 (99%) |
| GPS fix fits the trip's track | 294 | 143 |
| Delay from Renfe's trip updates | 297 | 155 |

- Unmatched: 5 trains that aren't in Renfe's static timetable at all (added
  services, one `SPECIAL_…` train). They're shown at their GPS position with
  Renfe's delay, but without a route.
- Drawn position vs. GPS at load: median 0 m, p90 459 m, max 1.3 km.
- 247 of 456 trains have a train ahead on the same line.

Fixed along the way, thanks to these checks:
- Some trains were drawn hundreds of km from their GPS fix. The fix was
  projected onto the whole line instead of the trip's own section.
- 42 trains didn't match. They report positions up to ~50 min before departure
  while waiting at the origin; the window is now 60 min.
- Duplicate listings in the AV/LD/MD feed showed up as "0 km" spacings.
