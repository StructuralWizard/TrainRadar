# France (fr)

Part of [the Europe plan](README.md), wave 1. Proposed 2026-11-22; nothing built.

Checked 2026-11-22:
- SNCF's GTFS was downloaded and inspected;
- the live feeds below were called;
- transport.data.gouv.fr's licence pages and the SNCF data catalogue were read at source.

Three sites couldn't be opened from this session: numerique.sncf.com and digital.sncf.com (the
SNCF API's terms) and prim.iledefrance-mobilites.fr. Items that depend on them are marked
unverified.

## Summary

| | |
|---|---|
| **Operators** | SNCF Voyageurs (TGV INOUI, OUIGO, Intercités, TER, Transilien), Eurostar, Trenitalia France, Renfe, Transdev Rail Sud (ZOU!), CFC in Corsica; Lyria and DB's ICE run inside SNCF's data |
| **Timetables** | Excellent: SNCF's combined GTFS, 151 days ahead, daily, no key |
| **Live data** | Delays, cancellations, **platforms** and alerts, no key (except Île-de-France). No GPS |
| **Warnings, works, lifts** | Per-train alerts in six languages; works inside alerts and timetables; **lift and escalator status every hour** |
| **Verdict** | **The best open data of wave 1, and the biggest job.** Many operators, Paris, cross-border trains and ODbL's conditions. Build it after the architecture work, including the cross-border step (E0f) |

## Timetables

- **SNCF GTFS:**
  - Where: `https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip`,
    on transport.data.gouv.fr dataset "horaires-sncf".
  - Updates: 5.6 MB, rebuilt daily around 21:00 UTC; it covers **151 days** (now to 30 Apr 2027).
  - What: TER and TER coaches, TGV INOUI, OUIGO, Intercités including night trains, TramTrain, Lyria
    and ICE.
  - Format notes:
    - the product is in the `stop_id` prefix (e.g. `StopPoint:OCEOUIGO-87…`);
    - there are no shapes (OSM routing, as for OUIGO in Spain);
    - it includes strike and disruption changes known at 17:00 the day before.
  - **Licence:** ODbL (see Licences). No registration.
  - Also as NeTEx (32 MB); not needed.
- **Île-de-France:**
  - **Transilien GTFS** (`…/sncf/gtfs/transilien-gtfs.zip`, ODbL), about 1 month ahead.
  - **IDFM's GTFS** (`…/stif/GTFS/IDFM-gtfs.zip`, RER included), about 1 month ahead, under the
    Licence Mobilités.
- **Other operators,** all under Licence Ouverte 2.0 (commercial use allowed, with a credit, no
  share-alike):
  - Eurostar (`integration-storage.dm.eurostar.com/gtfs-prod/gtfs_static_commercial_v2.zip`);
  - Renfe's international AVE (`ssl.renfe.com/gtransit/Fichero_AV_INT/Renfe_AVE_Int.zip`);
  - Trenitalia France (only to 11 Dec 2026: check it's renewed);
  - Transdev Rail Sud and ZOU! regional trains.

  CFC's (Corsica) has expired (valid 3–9 Mar 2026), so ask CFC.

## Rail network and classification

- **SNCF Réseau's open data** (ODbL, WGS84 geometry), on `ressources.data.sncf.com`:

  | Dataset | What it gives |
  |---|---|
  | `vitesse-maximale-nominale-sur-ligne` | maximum speed, 5–350 km/h |
  | `liste-des-lignes-electrifiees` | electrification |
  | `lignes-lgv-et-par-ecartement` | high-speed lines and gauge |
  | `regime-dexploitation-des-lignes` | single or double track |
  | `gabarit-limite-des-obstacles-hauts-voyageurs` | loading gauge |
  | `formes-des-lignes-du-rfn` | line geometry |

  Last changed 2020–2022, so check against OSM and RINF.
- **Track:** OpenStreetMap, from Geofabrik's `europe/france` (4.8 GB). SNCF Réseau's attributes are
  matched onto it by line; that matched network is ODbL, like our OSM track already is.

## Live data

| Source | Address | What | Key |
|---|---|---|---|
| SNCF GTFS-RT trip updates | `https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates` | every 2 min, trains due in the next 60 min. Guaranteed only for TGV and Intercités; SNCF points to regional feeds for TER | no |
| SNCF SIRI ET Lite (beta) | `…/resource/sncf-siri-lite-estimated-timetable` | times **and platforms** | no |
| Eurostar GTFS-RT | `integration-storage.dm.eurostar.com/gtfs-prod/gtfs_rt_v2.bin` | delays, platforms | no |
| Renfe | `gtfsrt.renfe.com/trip_updates_LD.pb`, `vehicle_positions_LD.pb` | its AVE in France, **with GPS** (already read by our Spain backend) | no |
| Trenitalia France | `…/resource/trenitalia-gtfs-rt` | delays | no |
| Transdev Rail Sud, ZOU! | their GTFS-RT | delays | no |
| IDFM PRIM | SIRI Lite | Transilien and RER. Quotas: 1,000,000 a day for single-stop queries, **1,000 a day for the whole network** (one every 90 s) | yes |

- **GPS:** none for SNCF, so trains are placed by timetable plus delay. Renfe's AVE in France have
  GPS.
- **Platforms:** SIRI ET Lite (TGV and Intercités, checked) and Eurostar. TER: unverified.

## Warnings, planned works, lifts

- **Notices:**
  - **SNCF GTFS-RT service alerts** (`…/sncf-gtfs-rt-service-alerts`) and **SIRI SX Lite**:
    - every 2 min;
    - TER, Intercités and TGV including OUIGO (not Transilien or Eurostar);
    - one message per train, linked by train number, **in six languages**, no key.

    The app shows the user's language when the feed has it.
  - IDFM PRIM Info Trafic (20,000 calls a day) for Île-de-France incidents and planned works.
- **Planned works and replacement coaches:**
  - no SNCF Réseau works dataset;
  - works and coaches appear in the per-train alerts ("travaux", "autocar") and in the daily GTFS.
- **Lifts and escalators:** Gares & Connexions dataset `etat-fonctionnement-elevatique-gare`.
  - What: 2,550 lifts and escalators, OK/KO/unknown, hourly, "not contractual", ODbL, no key.
  - Matching: keyed by the station's id in the Gares & Connexions list. Since 7 Oct 2026 the
    coordinates are only in the "Accessibilité des gares" NeTEx.
  - In the app: station notices ("Ascensor fuera de servicio"), and journey alerts for saved
    journeys (J4).

## Storage

- **R2 `/fr/`:**
  - a **national** file (TGV INOUI, OUIGO, Intercités, Lyria, ICE, Eurostar, Renfe, Trenitalia);
  - **one file per TER region**;
  - **Île-de-France** (Transilien and RER) on its own.

  It's about UK-sized in total, and the split keeps phones light.
- **Plan-ahead:** weekly files, 9 weeks (SNCF publishes 151 days).
- **Licence Mobilités:** IDFM's data stays in its own file, never merged with the ODbL data (the
  two licences aren't compatible).

## Server

Eight feeds in `backend-eu/`:

| Adapter | Every | Output |
|---|---|---|
| `gtfsrt`: SNCF trip updates | 60 s (it changes every 2 min) | `fr/rt/trip_updates.pb` |
| `gtfsrt`: SNCF alerts | 60 s | `fr/rt/notices.json` |
| `siri`: SNCF ET Lite | 60–120 s | platforms, and times SNCF's GTFS-RT lacks |
| `gtfsrt`: Eurostar, Trenitalia, Transdev | 60 s each | merged into the trip updates |
| `idfm`: PRIM, whole network | 120 s (720 a day, under the 1,000 quota) | Île-de-France delays and Info Trafic |
| `lifts`: Gares & Connexions | 1 hour | station notices |

Renfe's AVE in France come from Spain's backend, which already fetches that feed.

## Registrations, passwords and secrets

- **Accounts:**
  - None for SNCF, Eurostar, Renfe, Trenitalia, Transdev or Gares & Connexions.
  - **IDFM PRIM**, opened by Metranos Ltd, for Transilien and RER live data. The key format and
    approval time are unverified; PRIM's site refused this session's address, so test it from a
    Worker.
  - **SNCF API (Navitia)** isn't needed; everything above is open.
  - **Possibly a data.gouv.fr account**, to republish a derived timetable (see Licences).
- **Secrets:**
  - `FR_IDFM_PRIM_KEY`;
  - `FR_DATAGOUV_API_KEY` only if republishing is required.

## Operators and tickets

Check each address when building; none was opened.

| Operator | Tickets |
|---|---|
| SNCF Voyageurs (TGV INOUI, Intercités, TER, Transilien) | sncf-connect.com |
| OUIGO | ouigo.com |
| Eurostar | eurostar.com |
| Trenitalia France | trenitalia.com |
| Renfe | renfe.com |
| Lyria | sncf-connect.com |
| DB (ICE) | bahn.de |
| Transdev Rail Sud / ZOU! | the region's site |
| CFC | the CFC's site |

## Language, time, stations, borders

- **Language:** French app strings and store listing.
- **Time zone:** Europe/Paris, the same as Madrid.
- **Station ids:**
  - 8-digit UIC codes (`87…`) everywhere: GTFS `StopArea:OCE87…`, the live feeds, SIRI
    (`FR:ScheduledStopPoint::87…`), the Gares & Connexions list (2,792 stations, with 3-letter
    codes) and SNCF Réseau's list.
  - Ours become `fr:87…`.
  - Monaco-Monte-Carlo is 87756403, served through SNCF's and ZOU!'s data.
- **Cross-border:**
  - SNCF's GTFS reaches Switzerland, Germany, Belgium, Luxembourg, Italy and Spain, with each
    country's own UIC codes (85, 80, 88, 82, 83, 71).
  - Spanish stops (71…) link to Renfe's stations through Adif's five digits, as OUIGO's do today.
  - Barcelona–Lyon/Marseille/Paris appear in both SNCF's and Renfe's data, so they are merged.

## Licences

- **ODbL** (SNCF timetables and live data, Gares & Connexions, SNCF Réseau):
  - **Credit** on a "data sources" page in the app.
  - **Share-alike:** transport.data.gouv.fr's special conditions limit share-alike to derived
    databases of the same nature, granularity, time frame and area. If we correct or merge SNCF's
    timetables, the result must be republished on transport.data.gouv.fr in its original format.
    Interpolated positions and predictions are "produced works" and aren't covered. For a lawyer to
    confirm; republishing would be a nightly GTFS export.
  - **SNCF Réseau's network datasets** sit outside the access point, so plain ODbL applies: our
    matched network stays ODbL, as now.
- **Licence Mobilités** (IDFM): based on the ODbL but not compatible with it, so keep IDFM's data
  separate.
- **Licence Ouverte 2.0** (Eurostar, Renfe, Trenitalia, Transdev): credit only.

## Risks

- The live data's limited guarantee (TGV and Intercités).
- Short horizons for Transilien, IDFM and Trenitalia.
- CFC's expired data.
- Possibly stale network data.
- The share-alike conditions.
- Size: France is roughly as big as the UK, so the regional split matters.

## Steps

- **F0:** feed checks for every source; the PRIM account and key.
- **F1:** reference data (national, TER regions, Île-de-France, cross-border links with Spain);
  `verify`; bench (Paris–Lyon, Lille–Marseille, Bordeaux–Toulouse, Paris–Barcelona).
- **F2:** live: SNCF trip updates and alerts, SIRI platforms, Eurostar, Trenitalia, Transdev; lift
  status.
- **F3:** app: French strings, credits, operators; release as beta.
- **F4:** Île-de-France live (PRIM).
