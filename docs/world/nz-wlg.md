# Wellington (nz-wlg)

Pacific/Auckland (New Zealand's clock rules: summer time from the last Sunday of September to the
first Sunday of April) · the app's country `nz`, with Auckland ([nz-akl.md](nz-akl.md)).

**Built 2026-11-25 (hidden): timetable and live data.**
- **Timetable:** Metlink's GTFS (Greater Wellington Regional Council,
  `static.opendata.metlink.org.nz/v1/gtfs/full.zip`, CC BY 4.0, no key), cut to trains (the
  Kapiti, Hutt Valley, Melling, Johnsonville and Wairarapa lines; the Cable Car, buses and ferries
  are dropped), region `nz-wlg`. Track: Geofabrik's New Zealand extract.
- **Live:** GTFS-Realtime on `api.opendata.metlink.org.nz/v1/gtfs-rt/{tripupdates,
  vehiclepositions,servicealerts}`, the key `NZ_METLINK_API_KEY` in the `x-api-key` header;
  protobuf, every mode in one feed, trip ids the timetable's (`tools/nz/rt-probe.mjs wlg`, Nov
  2026: 4 of 5 early-morning trips were trains, all in the timetable). The `eu` Worker
  (`backend-eu/src/newzealand.js`) keeps the trips `…__RAIL__…` and routes 2–6, and the alerts
  naming them, into `nz/rt/`, with Auckland's; its switch is `NZ_LIVE_ENABLED`.
- **Deploy:** one New Zealand build (`data/nz/`) holds both regions; `NZ_WLG_ENABLED` adds
  Wellington, and the OSM track (Geofabrik's New Zealand) is fetched once for both.
