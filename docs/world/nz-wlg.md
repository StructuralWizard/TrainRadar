# Wellington (nz-wlg)

Pacific/Auckland (New Zealand's clock rules: summer time from the last Sunday of September to the
first Sunday of April) · the app's country `nz`, Wellington for now (Auckland to follow, key
`NZ_AT_API_KEY`).

**Built 2026-11-25 (hidden), timetable first.**
- **Timetable:** Metlink's GTFS (Greater Wellington Regional Council,
  `static.opendata.metlink.org.nz/v1/gtfs/full.zip`, CC BY 4.0, no key), cut to trains (the
  Kapiti, Hutt Valley, Melling, Johnsonville and Wairarapa lines; the Cable Car, buses and ferries
  are dropped), region `nz-wlg`. Track: Geofabrik's New Zealand extract.
- **Live, next:** GTFS-Realtime on `api.opendata.metlink.org.nz/v1/gtfs-rt/{tripupdates,
  vehiclepositions,servicealerts}`, the key `NZ_METLINK_API_KEY` in the `x-api-key` header.
  `tools/nz/wlg-probe.mjs` tries each in the Refdata run (protobuf or JSON, and how many trip ids
  the train timetable has); the Worker follows from what answers.
- **Deploy:** `NZ_WLG_ENABLED` = `true` builds `data/nz/` (`?country=nz`).
