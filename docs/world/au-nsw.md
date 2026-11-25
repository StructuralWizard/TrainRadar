# New South Wales (au-nsw)

Australia/Sydney (UTC+10, +11 from the first Sunday of October to the first Sunday of April) ·
English · the app's country `au` (`?country=au`).

**Built 2026-11-25 (hidden, by timetable for now).** The first country outside Europe:
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

**Live, next:** TfNSW publishes GTFS-Realtime trip updates and GPS vehicle positions for Sydney
Trains, NSW TrainLink and Sydney Metro, and alerts. `tools/au/nsw-probe.mjs` tries each v1 and v2
endpoint with the key in the Refdata run and reports which answer and how many trips match the
timetable; the Worker follows from that.

**Variables:** `AU_NSW_ENABLED` (the timetable).
