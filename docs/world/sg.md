# Singapore (sg)

Asia/Singapore (UTC+8 all year) · the app's country `sg`.

**Built 2026-11-25 (hidden): estimated trains, real alerts.** The maintainer chose estimated trains
(2026-11-25): LTA publishes no MRT/LRT timetable and no train positions, so the trains are drawn
from the lines' usual frequencies and every one says so.

- **Timetable (estimated):** `tools/sg/osm-gtfs.py` builds a GTFS from OpenStreetMap's MRT and LRT
  route relations (route=subway / light_rail, from Geofabrik's Malaysia–Singapore–Brunei extract:
  stations in order and the track) and `tools/sg/lines.tsv` (each line's first and last trains
  and peak, off-peak and weekend headways, approximations of the operators' published figures;
  correct them there). Running times: the distance along the track at the line's speed, plus a
  dwell at each station. Trip ids start with `est-`; region `sg`, `live: false`.
- **App:** the country `sg` (hidden), "Singapore (estimated)": "N estimated trains", and each
  train's card says its position is estimated from the line's frequency (`estimatedPosition`).
- **Live:** LTA DataMall's Train Service Alerts (`ltaodataservice/TrainServiceAlerts`, the key
  `SG_LTA_ACCOUNT_KEY` in the `AccountKey` header, once a minute), turned into GTFS-Realtime
  alerts on the lines' route ids by `backend-eu/src/singapore.js` → `sg/rt/alerts.pb`.
- **First build (Nov 2026):** 7 lines, 146 stations, 7,800 estimated trips a day-pair. Lines are
  told apart by the relation's name first (the LRT loops, Bukit Panjang, the Changi Airport
  branch), then by the station codes (a branch only with most of the stops); the Jurong Region
  Line (not open yet) is left out. LTA's alerts answered HTTP 401 with the first key.
- **Second build:** 12 lines, 192 stations, 11,175 trips; then fixed: lines by OSM's line ref
  (NSL, EWL…) before the station codes (one North-South direction had come out East-West),
  Sentosa Express and Changi Airport's Skytrain left out, loops keep both directions, a loop's
  stop position ("Sengkang - East Loop Clockwise") is its station. The Circle Line has two
  services in OSM (the loop and Dhoby Ghaut–Prince Edward Road), each at the line's headway.
- **Not yet:** live platform crowd density (DataMall's `PCDRealTime`) on station cards.
- **Deploy:** `SG_ENABLED` = `true` builds `data/sg/`; `SG_LIVE_ENABLED` = `true` (with
  `SG_LTA_ACCOUNT_KEY`) adds the alerts in the `eu` Worker.
- **Licences:** OpenStreetMap ODbL; LTA DataMall under the Singapore Open Data Licence.

**Circle Line (2026-11-26):** OpenStreetMap has two Circle Line services per direction (the loop
and Dhoby Ghaut–Prince Edward Road). Each ran at the line's full headway, doubling the trains on
the shared section; the generator now gives each service every other train (two services per
direction: twice the headway each, the second half a headway later).
