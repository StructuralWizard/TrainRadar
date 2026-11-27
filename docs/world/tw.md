# Taiwan (tw)

Asia/Taipei (UTC+8 all year) · Chinese and English names · the app's country `tw`.

**Status (2026-11-27): built, waiting for TDX.** The account's GTFS service ("GTFS服務Beta") was
applied for on 2026-11-27 and shows 待審核 (pending review). TDX reviews by hand on weekdays
(09:00–12:00 and 13:30–18:00 Taiwan time), so expect it by Monday or Tuesday. Until then the
GTFS endpoint answers 401/403. Taiwan is in `CONFIG.hiddenCountries` (the website opens it only
from `?country=tw`; the Android app never shows it) and the workflows skip it until the
repository variable `TW_ENABLED` is `true`.

**Turning it on, once TDX approves:** set `TW_ENABLED` to `true` (Settings → Secrets and
variables → Actions → Variables) and run the Refdata workflow on a pull request: its "Taiwan"
step prints the routes kept. When the data looks right, move `tw` from `hiddenCountries` to
`countries` in `web/js/config.js`.

- **Source:** TDX (Transport Data eXchange, Ministry of Transportation and Communications), the
  national GTFS, every mode and about 100 operators:
  `GET https://tdx.transportdata.tw/api/gtfs/V3/Map/GTFS/Static` with `Authorization: Bearer`
  (the path from Transitland's catalogue; TDX shows it in 資料服務 → GTFS服務Beta once
  approved). Per mode: `…/Static/Rail/TRTC` (Taipei Metro), and so on.
- **Auth:** OIDC client credentials (`TW_TDX_CLIENT_ID`, `TW_TDX_CLIENT_SECRET`, GitHub Actions
  secrets; AGENTS.md) → `POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token`,
  a token valid about 24 hours. One token per workflow run, never one per call.
- **Budget (free Basic plan):** about 3,000 calls a month and 5 a minute per key. The GTFS file is
  kept in the workflows' cache for the ISO week (`tdx-gtfs-tw-v1-<week>`): one token and one
  download a week, about 8 calls a month. No retries: a 401/403 is "pending" (`fetch-eu.sh tw`
  exits 3) and the run goes on without Taiwan.
- **Build:** `tools/fetch-eu.sh tw` cuts the national file to trains (route types 2, 100–117),
  metros (1, 400–402) and light rail (0, 900); the GTFS-Fares v2 tables (`fare_*.txt`, very large)
  are never read. English names from its translations.txt where there are, "Taipei 臺北"
  (`gtfs-tidy.py --lang=en --bilingual`). `refdata-build --tw-gtfs` → one region `tw`, by
  timetable. Once the real file is in, the region can be split by operator (TRA, THSR, Taipei
  Metro, Kaohsiung…) for the area drop-down.
- **Live delays:** not on the free plan's budget for continuous polling. Possible later: on
  demand, with a monthly counter that stops at 2,500 calls.
- **Licence:** Open Government Data License v1.0 (Taiwan): commercial use allowed with
  attribution "Source: MOTC TDX".

**Variables:** `TW_ENABLED` (the timetable). **Secrets:** `TW_TDX_CLIENT_ID`, `TW_TDX_CLIENT_SECRET`.
