# Ireland (ie)

Part of [the Europe plan](README.md), wave 1. Proposed 2026-11-22.

**Built: I1, the timetable (2026-11-22).**
- `data/ie/` behind `IE_ENABLED`; opened on the site with `?country=ie`.
- Trains go by timetable, and the app says so.
- Details in [data-sources-ie.md](../data-sources-ie.md).

Checked 2026-11-22:
- the Irish Rail GTFS was downloaded and inspected;
- Irish Rail's API was called live;
- the NTA's developer portal and its usage policy were read at source.

## Summary

| | |
|---|---|
| **Operator** | Iarnród Éireann (Irish Rail): DART, Commuter and InterCity, and the Enterprise to Belfast with NI Railways |
| **Timetables** | Official, CC BY 4.0, daily, but only about 3 weeks ahead |
| **Live data** | Delays and cancellations from the NTA's GTFS-Realtime (free key, CC BY 4.0). No GPS, no platforms |
| **Warnings, works, lifts** | Alerts in the NTA feed, replacement buses in the timetable; lifts only on a weekly web page |
| **Verdict** | **Good, and the quickest of wave 1.** Trains placed by timetable plus live delay (like the UK), in English, with the same gauge as Northern Ireland and joined to it by the Enterprise |

## Timetables

- **TFI's Irish Rail GTFS:**
  - Where: `https://www.transportforireland.ie/transitData/Data/GTFS_Irish_Rail.zip`, listed on
    transportforireland.ie's data page.
  - What: every Irish Rail service, including the Enterprise.
  - Updates: rebuilt daily; 6.3 MB. No registration.
  - **Licence:** CC BY 4.0, commercial use allowed, plus the NTA's fair-use policy.
- **The horizon is about 3 weeks** (20 Nov–12 Dec 2026), so the 9-week planner stops there. The app
  already shows each region's `until`: "Irish Rail aún no ha publicado horarios para ese día".
- **What the file holds:**
  - the trip's short name is Irish Rail's train code (it links the GTFS to Irish Rail's API);
  - planned replacement buses are trips named `BUS###`, shown as buses.
- **The live feed's companion:** the live feed's ids only match the same day's `GTFS_Realtime.zip`
  (152 MB, every operator). The build takes Irish Rail's part of it, daily. Its `agency_timezone`
  says Europe/London, which is the same clock as Dublin all year; the registry says Europe/Dublin.

## Rail network and classification

- **Track:** OpenStreetMap, from Geofabrik's `europe/ireland-and-northern-ireland`. That extract
  covers Northern Ireland too, which can move to it.
- **Infrastructure manager:**
  - nothing open apart from its network statement (PDF);
  - the mapping agency's "Rail Network Segment" on data.gov.ie is centrelines only (licence
    unverified).

  Speed and electrification therefore come from OSM tags and ERA's register of infrastructure
  (RINF).
- **Gauge and lines:**
  - Irish gauge, 1,600 mm, as in Northern Ireland;
  - no high-speed lines;
  - only the DART is electrified (1,500 V DC overhead).

## Live data

1. **NTA GTFS-Realtime v2:**
   - Where: `https://api.nationaltransport.ie/gtfsr/v2/TripUpdates`, also `/v2/Vehicles` and
     `/v2/alerts`.
   - How: pulled, with a key in the `x-api-key` header, **at most one call per 60 s per key**.
   - **Terms:** CC BY 4.0, with credit and an "as is" statement. The usage policy forbids
     "commercial exploitation … primarily for profit without adding significant value". TrainRadar
     adds a lot (a map, alerts, journeys), but ask the NTA to confirm in writing.
   - **Irish Rail coverage:** the NTA's 2023 notice says v2 added Irish Rail. The feed check confirms
     it with the key on day 1.
2. **Irish Rail's realtime API:**
   - Where: `https://api.irishrail.ie/realtime/`, XML, no key.
   - What: running trains; station boards for the next 90 minutes (due, late, expected); each train's
     stops.
   - **Terms:** "as is", no licence, and Irish Rail's terms forbid commercial use of its digital
     platforms without permission. **Only with written permission.**
   - **Gaps:**
     - Dundalk–Belfast, Cork and some branches return scheduled times only;
     - some glitches seen, such as a train "1442 mins late".
- **Platforms:** none, in either source.
- **GPS:** none. The API's position is the last station passed, so trains are placed by timetable
  plus delay. Whether the NTA's vehicles feed covers trains is unverified.

## Warnings, planned works, lifts

- **Notices:**
  - NTA GTFS-RT `/v2/alerts` (key; rail coverage to confirm);
  - the API's public messages, if permitted.

  Irish Rail's service-updates page has no feed.
- **Planned works:** replacement buses are in the GTFS (for example the Maynooth line, 28–29 Nov
  2026). The Weekly Circular (possessions, speed limits) is only for railway companies.
- **Lifts and escalators:** weekly "Travel Alerts" on irishrail.ie station pages. The app links to
  them; nothing to poll.

## Storage

- **R2 `/ie/`:** one national file, smaller than Spain's long-distance one, rebuilt daily so the ids
  match the live feed.
- **Plan-ahead:** only as far as the GTFS goes (about 3 weeks).

## Server

- **`backend-eu/`, adapter `gtfsrt`:**
  - fetches the NTA's TripUpdates every 60 s (the key's limit);
  - keeps Irish Rail's trips and renames their ids to ours;
  - writes `ie/rt/trip_updates.pb`.
- **Alerts:** every 60 s, into `ie/rt/notices.json`.
- **Cost:** a few thousand requests a day; very little CPU.
- **Irish Rail's API**, if Irish Rail agrees, as a second adapter for the scheduled-only gaps.

## Registrations, passwords and secrets

- **Account:** the NTA developer portal (developer.nationaltransport.ie), opened by Metranos Ltd.
  - The GTFS-Realtime product is approved automatically and active about 15 minutes after
    subscribing; one subscription per user.
  - It gives a primary and a secondary key. Expiry isn't stated.
- **Letters:**
  - the NTA: confirm the fair-use clause for TrainRadar;
  - Irish Rail: permission to use its realtime API (optional).
- **Secret:** `IE_NTA_API_KEY`, stored as a GitHub Actions secret (for the feed check) and a Worker
  secret.

## Operators and tickets

| Operator | Tickets |
|---|---|
| Iarnród Éireann | irishrail.ie |
| Enterprise (Irish Rail + NI Railways) | irishrail.ie, translink.co.uk |

## Language, time, stations, borders

- **Language:** English; the app's EN strings already exist. Station names as published (some
  bilingual).
- **Time zone:** Europe/Dublin, an hour behind Madrid (the same as Northern Ireland).
- **Station ids:**
  - The GTFS stop code is "999" plus Irish Rail's numeric station id. That matches 148 of 152 stops;
    4 newer stations differ, such as Woodbrook.
  - The API also uses letter codes (CNLLY).
  - Ours become `ie:` plus the GTFS id.
- **Cross-border:**
  - The Enterprise is in both the NTA's and Translink's data. Merge them: one train, with NI's
    stations linked to Ireland's ([plan-europe.md](../plan-europe.md), A3).
  - Irish Rail's coordinates for Belfast differ from the GTFS's, which uses Belfast Grand Central.

## Credits

- "Contains data from the National Transport Authority" (CC BY 4.0), with the "as is" statement.
- OpenStreetMap, ODbL.

## Risks

- The fair-use wording.
- The short horizon.
- Ids that change with every static version, so matching depends on a daily rebuild.
- GTFS-R's rail coverage, to confirm.
- Irish Rail's API has no licence.

## Steps

- **I1, done 2026-11-22:**
  - reference data from the NTA's GTFS, rebuilt daily (`IE_ENABLED`);
  - each region's time zone in the manifest and the engine;
  - Ireland in the app as a hidden country (`?country=ie`), by timetable, with the NTA's credit.
- **I0:**
  - the NTA account and key (`IE_NTA_API_KEY`, for the maintainer to approve);
  - a feed check that proves the live feed's rail coverage and the alerts.
- **I2, built 2026-11-22:**
  - the Europe ingest Worker (`backend-eu/`): trip updates and alerts → `ie/rt/`;
  - `live: true` in the app;
  - deployed with `IE_ENABLED` and the `IE_NTA_API_KEY` secret.
- **I3:**
  - the Enterprise merged with Northern Ireland's;
  - operator links;
  - Ireland offered to everyone (`countries`), then in the Android app.
