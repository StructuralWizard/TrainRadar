# Victoria (au-vic)

Australia/Melbourne (the same clock rules as Sydney's) · the app's country `au`, with New South
Wales.

**Built 2026-11-25 (hidden), timetable first.**
- **Timetable:** Transport Victoria's GTFS Schedule (opendata.transport.vic.gov.au, CC BY 4.0): one
  archive with a numbered folder per mode; `tools/au/vic-fetch.py` finds it through the portal's
  catalogue and takes `1/` (V/Line, regional) and `2/` (Metro Trains, Melbourne); merged and cut
  to trains, region `au-vic`.
- **Live, next:** GTFS-Realtime on `api.opendata.transport.vic.gov.au/opendata/public-transport/
  gtfs/realtime/v1/{metro,vline}/{trip-updates,vehicle-positions,service-alerts}`, the key
  `AU_VIC_API_KEY` in the `KeyID` header, 24 calls a minute per feed. `tools/au/vic-probe.mjs`
  tries each in the Refdata run; the Worker follows from what answers.
- **Deploy:** one Australia build (`data/au/`) holds both states; `AU_VIC_ENABLED` adds Victoria,
  and the OSM track (Geofabrik's Australia) is fetched once for both.
