# Plan 4: Northern Ireland (NI Railways) in the UK view

Status: **proposed, 2026-11-21**. Facts from the NI feed check (`tools/ni-feed-check/`,
workflow "NI feed check", run on PR #71). Decisions below are proposals for the
maintainer.

Network Rail's data covers Great Britain only, so the UK view (plan 3) has no trains in
Northern Ireland. NI Railways is run by Translink, which publishes its own open data on
OpenDataNI under the Open Government Licence. NI would be part of the same "Reino Unido"
view: one more region, not a third country.

## What exists (checked 2026-11-21)

**Timetable: "Translink Northern Ireland Rail Timetable Data"** (OpenDataNI dataset
`nir20160126v2`, OGL)
- One ZIP (111 KB) holding one **TransXChange** XML file (5.6 MB, windows-1252), the
  standard UK bus and rail timetable format. Not GTFS, and not CIF, whatever older
  listings say (a 2016 DOCX about CIF and two XLS location-code sheets are leftovers).
- Updated on 2 October 2026; the services' operating periods run from 10 September to
  **13 December 2026**. A new file has to come before then, so the deploy must watch for
  it.
- Contents:
  - 115 stop points, each with latitude and longitude, name and ATCO code. These include
    platforms, so there are fewer stations.
  - Lines named "Bangor Line" and so on.
  - 460 journey patterns and 1,142 vehicle journeys.
  - Operating profiles with days of the week and days of non-operation.
  - Run times between stops.
- No train numbers or headcodes, only Translink's own journey codes. A live feed would
  have to be matched by station and time.

**Live arrivals and departures: "Translink Northern Ireland Railway Real Time Passenger
Information"** (OGL, metadata last changed 2022)
- OpenDataNI's own API (`apis.opendatani.gov.uk/translink/…`) answers **503** to every
  request, including the example station `3042A7.xml`. It looks retired.
- The listed fallback, `tiger.worldline.global/toc/NIR`, is now a web page (an Angular
  app) whose data comes from `tiger-api-portal.worldline.global`. That is Worldline's
  API portal, which most likely needs registration or a key. Its terms are not known.
- So there is **no open live feed we can use today**.

## Proposal

**4b: NI by timetable (no live data needed).**
- Import the TransXChange file in `refdata-build` (a new `txc.rs`, like `nrsched.rs`):
  - stations from the stop points, with platforms grouped by name and coordinates
    averaged;
  - trips from the vehicle journeys, with their dates from the operating profiles;
  - stop times from the journey pattern run and wait times.
- Track from OpenStreetMap: Geofabrik's "Ireland and Northern Ireland" extract, cut to
  NI, as for Great Britain.
- Output: a region `ni` in `data/uk/`, timetable-only like OUIGO in Spain. Trains are
  drawn by timetable and labelled "según horario", with no delay colour.
- The deploy's UK step downloads the file through the OpenDataNI API (`package_show`).
  It rebuilds when `metadata_modified` changes, and warns when the services' end date is
  under two weeks away.
- Attribution: Translink / NI Railways under the OGL, in the map credits and in "¿De
  dónde salen estos datos?".
- Effort: one PR. The importer is the bulk, with tests on a trimmed real file. The app
  changes little, because timetable-only trains already exist.

**4c: live NI delays, only if access exists.**
- Ask Translink or Worldline about the Tiger API: registration, terms, and whether app
  use is allowed. Alternatively, ask OpenDataNI whether the old API is coming back.
  Contact: opendatani@nidirect.gov.uk.
- If granted, the UK ingest Worker (`backend-uk/`) would poll the station boards. It
  would match each train to the timetable by station and scheduled time, then publish
  trip updates beside Great Britain's. The app would then colour NI trains by delay,
  like the rest of the UK.

**Order:** after Great Britain's live feed is back (Network Rail login) and 3.0 ships. NI by
timetable can come in 3.0 or right after; it doesn't depend on the Network Rail account.

## Questions for the maintainer

1. NI by timetable only (4b) first, with live delays later if Translink or Worldline grant
   access: agreed?
2. Shall I draft the email asking about the Tiger API or OpenDataNI's real-time API?
