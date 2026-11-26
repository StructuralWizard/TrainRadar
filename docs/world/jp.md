# Japan (jp)

Asia/Tokyo (UTC+9 all year) · Japanese and English names · the app's country `jp`.

**Built 2026-11-26 (hidden).** Source: the Public Transportation Open Data Center's public API
(`api-public.odpt.org`, no key). Only datasets under an open licence (CC BY 4.0, CC0, ODbL) are
used; "Challenge-limited" datasets never; "Other licence" ones (Hakodate's tram, Shimoden…) not
until their terms are read. Attribution: "<operator> / 公共交通オープンデータセンター (ODPT), CC BY 4.0".

- **Tokyo (`jp-tyo`):** Toei (Tokyo Metropolitan Bureau of Transportation), CC BY 4.0: the
  Asakusa (A), Mita (I), Shinjuku (S) and Oedo (E) subway lines, the Toden Arakawa tram (SA) and
  the Nippori-Toneri Liner (NT). `files/Toei/data/Toei-Train-GTFS.zip`: 149 stations, 5,600
  trips; no shapes (straight lines between stations). Names from its translations.txt: lines in
  English, stations "Shinjuku 新宿".
- **Tokyo live:** `gtfs/realtime/toei_odpt_train_vehicle`, `…_trip_update`, `…_alert`
  (`backend-eu/src/japan.js`): 90 of 90 trains matched the timetable (2026-11-26). One call every
  15 s (GPS every 30 s, delays every 40 s, alerts every 2 minutes): 5,760 a day of ODPT's limits
  (60 a minute, 3,600 an hour, 24,000 a day per address).
- **Kōchi (`jp-kch`):** Tosaden Traffic's trams, CC BY 4.0
  (`files/odpt/TosadenTraffic/Streetcar.zip?date=current`), by timetable (no live feed). Stops
  have kana readings only: romaji from them (`tools/gtfs-tidy.py`), and one platform per
  direction, merged.
- **Not yet (Basic Licence, needs a consumer key `JP_ODPT_CONSUMER_KEY` on `api.odpt.org`):**
  Tokyo Metro, JR East, Yokohama Municipal Subway, Rinkai (TWR), Tama Monorail, Yurikamome,
  Saitama Railway, and the private railways' timetables. The same code takes them once the key is
  approved and added to AGENTS.md.

**Variables:** `JP_ENABLED` (the timetables), `JP_LIVE_ENABLED` (the Worker).
