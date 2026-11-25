# New South Wales (au-nsw)

Australia/Sydney (UTC+10, +11 from the first Sunday of October to the first Sunday of April) ·
English · the app's country `au` (`?country=au`).

**Built 2026-11-25 (hidden).** The first country outside Europe:
- **Time zone:** the engine now keeps a time zone per region with its own clock rules
  (`trainradar_proto::time::Zone`: south-eastern Australia, New Zealand, fixed offsets such as
  Singapore and Brisbane), instead of a fixed distance from Madrid, which only holds for zones with
  the EU's summer-time dates.
- **Timetable:** Transport for NSW's open data (`api.transport.nsw.gov.au`, key `AU_NSW_API_KEY`
  in the `Authorization: apikey …` header, CC BY 4.0). `tools/fetch-eu.sh au-nsw` downloads
  Sydney Trains', NSW TrainLink's and Sydney Metro's schedules (v2 where offered, else v1), merges
  them and keeps the trains (GTFS types 2 and 100–117; Sydney Metro's own route type, if it is
  401, is left out for now, as are coaches). Region `au-nsw`.
- **Track:** Geofabrik's Australia extract (`australia-oceania/australia`), cached weekly.

**Live (2026-11-25):** the probe found, with the key: Sydney Trains v2 (trip updates 100 % in the
timetable, GPS 80 %, the rest non-timetabled runs), NSW TrainLink v1 (trip updates 64 %, GPS 86 %),
Sydney Metro (v1 and v2 answer; 0 % until its metro route type was kept, now `--also=401,1`), and
v2 alerts for all three. `backend-eu/src/australia.js` takes one call every 8 s (10,800 a day of the
60,000 quota): Sydney Trains' GPS every 16 s, every other feed about every two minutes, each a part
of `au/rt/vehicle_positions.pb`, `trip_updates.pb` and `alerts.pb`. Region `au-nsw` is mixed: GPS
where a train sends it, timetable plus delay for the rest.

**Variables:** `AU_NSW_ENABLED` (the timetable), `AU_NSW_LIVE_ENABLED` (the Worker).
