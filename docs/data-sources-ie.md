# Ireland's data sources

Status: **checked 2026-11-22**. The files were downloaded and read. The plan is in
[europe/ie.md](europe/ie.md).

## Timetable

| What | Where | Notes |
|---|---|---|
| Irish Rail GTFS | `https://www.transportforireland.ie/transitData/Data/GTFS_Irish_Rail.zip` (the National Transport Authority, Transport for Ireland) | About 6 MB, rebuilt daily, about 3 weeks ahead. On 21 Nov 2026: 2,092 trips, 152 stops, 19 routes |

- **Download:** `tools/fetch-ie.sh` downloads it, with no key, along with Geofabrik's
  Ireland-and-Northern-Ireland OSM extract for the track.
- **Ids match the live feed's file.** Trip ids and stop ids are the same as in the NTA's combined
  `GTFS_Realtime.zip`, the static file that goes with its GTFS-Realtime feed. On 22 Nov 2026,
  2,092 of 2,092 trips and 152 of 152 stops matched. The live step can use the small file, as long
  as both are from the same day; that's why Ireland is rebuilt daily.
- **Time zone:** `agency_timezone` says Europe/London, which is the same clock as Dublin all year.
  The manifest says Europe/Dublin.
- **Line names:**
  - DART, InterCity and Commuter come through as they are.
  - The rest are named "rail" in the file, so `refdata-build` names them (`irish_product`):
    - Enterprise for Dublin–Belfast;
    - Commuter for the Drogheda/Dundalk, Maynooth, Portlaoise and Mallow–Cobh routes;
    - InterCity for the others.
- **Replacement buses:** planned replacement buses are trips named `BUS…` (49 in the 21 Nov file).
  They are dropped from the trains, so no bus is drawn on the track.
- **Station ids:** stop ids are the national stop codes (`8220IR0132` is Dublin Heuston).
  `stop_code` is "999" plus Irish Rail's numeric station id.
- **Irish names:** `translations.txt` has some station names in Irish; they aren't used yet.

## Licence and credit

- **Licence:** CC BY 4.0, plus the NTA's usage policy (developer.nationaltransport.ie/usagepolicy):
  - a credit and an "as is" statement;
  - no excessive downloading;
  - no commercial exploitation "primarily for profit without adding significant value".

  TrainRadar adds a lot on top: the map, journeys and alerts. Ask the NTA to confirm in writing.
- **Credit,** in the app and on the licences page: "Datos: horario de Iarnród Éireann de la
  National Transport Authority (Transport for Ireland), CC BY 4.0, ofrecido «tal cual»".

## Size

- **8-day window:** 1,856 trips, 835 patterns, 152 stations; the timetable is 392 KB before
  compression.
- **Plan ahead:** 2,000 trips, until 12 Dec 2026 (the end of the published timetable).
- **Journeys bench** (`journeys_bench -- data/ie --ie`): six Irish trips in 15 ms in total,
  including Dublin Heuston → Cork, Connolly → Sligo, Bray → Howth (DART) and Connolly → Belfast
  (Enterprise).

## Live data

- **Source:** the NTA's GTFS-Realtime v2 (`https://api.nationaltransport.ie/gtfsr/v2/TripUpdates`
  and `/alerts`).
- **Access:** a key in the `x-api-key` header (`IE_NTA_API_KEY`, approved 2026-11-22), at most one
  call per 60 s per key, for all its feeds together.
- **Our Worker:** `backend-eu/` fetches trip updates every minute, with alerts every fifth minute
  instead, keeps Irish Rail's, and writes `ie/rt/` ([backend-eu/README.md](../backend-eu/README.md)).
- **In the app:** trains are placed by timetable plus their live delay, like the UK's (no GPS in the
  feed).
- **The secondary key** the portal shows is a spare, for rotating the key without downtime. Don't
  use it to call twice a minute.
