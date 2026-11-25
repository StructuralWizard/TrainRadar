# Auckland (nz-akl)

Pacific/Auckland · the app's country `nz`, with Wellington ([nz-wlg.md](nz-wlg.md)).

**Built 2026-11-25 (hidden), timetable first.**
- **Timetable:** Auckland Transport's GTFS (`gtfs.at.govt.nz/gtfs.zip`, CC BY 4.0, no key), cut
  to trains (the Eastern, Southern, Western and Onehunga lines; buses and ferries are dropped),
  region `nz-akl`.
- **Live, next:** GTFS-Realtime on `api.at.govt.nz/realtime/legacy` (combined) and its
  `/tripupdates`, `/vehiclelocations` and `/servicealerts`, the key `NZ_AT_API_KEY` in the
  `Ocp-Apim-Subscription-Key` header (developer portal dev-portal.at.govt.nz).
  `tools/nz/rt-probe.mjs akl` tries each in the Refdata run (protobuf or JSON, and how many trip
  ids the train timetable has); the Worker follows from what answers.
- **Deploy:** `NZ_AKL_ENABLED` = `true` adds Auckland to the New Zealand build (`data/nz/`).
