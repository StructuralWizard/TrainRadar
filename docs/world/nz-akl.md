# Auckland (nz-akl)

Pacific/Auckland · the app's country `nz`, with Wellington ([nz-wlg.md](nz-wlg.md)).

**Built 2026-11-25 (hidden): timetable and live data.**
- **Timetable:** Auckland Transport's GTFS (`gtfs.at.govt.nz/gtfs.zip`, CC BY 4.0, no key), cut
  to trains (the Eastern, Southern, Western and Onehunga lines; buses and ferries are dropped),
  region `nz-akl`.
- **Live:** GTFS-Realtime on `api.at.govt.nz/realtime/legacy/{tripupdates,vehiclelocations,
  servicealerts}`, the key `NZ_AT_API_KEY` in the `Ocp-Apim-Subscription-Key` header (developer
  portal dev-portal.at.govt.nz); protobuf, every mode (900 vehicles, mostly buses). The `eu`
  Worker keeps the routes E-W, S-C, O-W and HUIA (Te Huia) and the alerts naming them, into
  `nz/rt/` with Wellington's; its switch is `NZ_LIVE_ENABLED`. Trip ids are the timetable's
  (`tools/nz/rt-probe.mjs akl`, Nov 2026).
- **Deploy:** `NZ_AKL_ENABLED` = `true` adds Auckland to the New Zealand build (`data/nz/`).
