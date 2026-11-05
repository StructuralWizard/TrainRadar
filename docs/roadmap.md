# Roadmap

| Phase | Scope |
|---|---|
| A1 | Repo, research, CORS check, workspace scaffold, CI ✅ (v0.1.0) |
| A2 | `refdata-build`: GTFS → `.bin` (AV/LD/MD, then Cercanías per núcleo), station spatial index, shape fallback ✅ (v0.2.0) |
| A3 | Engine: decode GTFS-RT, match trips, delays, interpolation, **train spacing**; Cloudflare Worker pass-through; OSM track for AV/LD/MD ✅ (v0.3.0) |
| A4 | Web: MapLibre map, coloured dots, stats bar, delayed list, popup with **spacing**, ES/EN ✅ (v0.4.0) |
| A5 | "Use my location", nearest stations, approaching trains, "Am I on this train?" ✅ (v0.5.0) |
| A6 | Incidents (Renfe alerts), Adif status research ✅ (v0.6.0) |
| A7 | Cloudflare Pages deploy, nightly refdata rebuild, PWA, v1.0.0 ✅ |
| B1 | Spacing by track projection, arrows, route highlight, stopped trains, speed/gauge/line speed/♿, OUIGO by timetable, coloured lines, official links ✅ |
| B2 | Gradient and height profile from the Copernicus DEM ✅; track count and electrification from the IGN network (IGR-RT, Adif data) ✅; design speed: no open source found |

## Train spacing (previous / following train)

Shown in the train popup: "Tren anterior: 6 min · 4.2 km" and "Tren siguiente: 9 min · 7.8 km".

**Same line, same direction.** Two trains are neighbours when they run the same way over
a common stretch of track. This is worked out at runtime from stop sequences, with no
precomputed corridors:

- Train L is *ahead* of train F if the segment L is on (previous stop → next stop) also
  appears later in F's remaining stops, in the same order. This covers trains on
  different lines sharing a trunk section (e.g. several Cercanías lines through one
  tunnel) and ignores trains going the other way.
- Distances come from each pattern's per-stop distance along its shape (stored in the
  `.bin` files since A2), so positions can be compared in metres along the track.

**Distance (km):** difference in along-track distance between the two trains on the shared
corridor. Never straight-line distance, which is misleading on curvy lines.

**Time (min):** how long after the leading train the following one is expected to pass the
leader's current position: the follower's scheduled time at that point plus its current delay,
minus now. This works for both moving and stopped trains, unlike dividing distance by speed.

**Edge cases:**
- No neighbour within the corridor (first/last train, end of line): show "—".
- Stale or interpolated positions: mark the gap as estimated and show the older fix age.
- Trains in the opposite direction, or on parallel but different lines (e.g. AV vs.
  conventional track), are never neighbours.
- Cost: sort trains per corridor by along-track distance once per update, O(n log n). Cheap
  enough for ~400 trains on a phone.

Unit tests (A3): ordering on a single shape, shared-trunk Cercanías lines, opposite
direction ignored, stopped follower, end of line.

## Phase C: central backend, web changes, Android Free + Pro

Plan approved on 2026-11-03 (two design rules changed on the maintainer's decision:
Renfe's feeds are fetched once, centrally; a backend recorder builds delay history).

| Phase | Scope | Status |
|---|---|---|
| C1 | Central poller (Durable Object alarm) → R2 `rt/*.pb` + `status.json`; live check workflow | ✅ running since 2026-11-04 |
| C2 | Web reads the live bucket (fallback: proxy), polls `status.json`; app promotion; legal pages | ✅ live on `live.mytrainradar.com` since 2026-11-04 |
| C3 | History recorder (engine in the Worker) → `summary.json`, D1 history, public API | ✅ recording since 2026-11-04 |
| C2b | Web history teaser (last 7 days) | ✅ code; shows with `API_PUBLIC_URL` |
| C4 | Android app (Capacitor), Free: favourites (2), share, links, back button; CI debug APK + emulator test | ✅ code ([android.md](android.md)) |
| C5 | Pro subscription + tips (Play Billing), on-device features, backup | C5a ✅ billing, Pro screen, tips, unlimited favourites, Pro details, export/import/delete · C5b ✅ my trips, claim helper, CSV and image · C5c ✅ delay alerts (background + in app), home-screen widget · C5d ✅ code: full history (7 days free, up to 12 months Pro), commute mode · left: real purchases on Play's test track |
| C6 | Store release prep, data safety, legal | |
| C8 | Yearly / lifetime (later) | |
| C7 | Optional ads (only if the maintainer says go) | |
