# Roadmap

| Phase | Scope |
|---|---|
| A1 | Repo, research, CORS check, workspace scaffold, CI ✅ |
| A2 | `refdata-build`: GTFS → `.bin` (AV/LD/MD, then Cercanías per núcleo), station spatial index, shape fallback |
| A3 | Engine: decode GTFS-RT, match trips, delays, interpolation, **train spacing**; Cloudflare Worker pass-through |
| A4 | Web: MapLibre map, coloured dots, stats bar, delayed list, popup with **spacing**, ES/EN |
| A5 | "Use my location", nearest stations, approaching trains, "Am I on this train?" |
| A6 | Incidents (Renfe alerts), Adif status research |
| A7 | Cloudflare Pages deploy, nightly refdata rebuild, PWA, v1.0.0 |

## Train spacing (previous / following train)

Shown in the train popup: "Tren anterior: 6 min · 4.2 km" and "Tren siguiente: 9 min · 7.8 km".

**Same line, same direction.** Two trains are neighbours when they run in the same direction
along a common stretch of track:

- refdata-build (A2) assigns each trip a *corridor* id and a direction. Trips sharing a
  `shape_id`, or shapes that overlap within ~30 m for most of their length, share a
  corridor. Cercanías lines that share track (e.g. a common trunk section) are linked over
  that shared stretch only.
- Each train's position is projected onto its shape to get a distance along it
  (linear referencing), in metres, from the GTFS `shape_dist_traveled` or computed.

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
