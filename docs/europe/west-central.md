# Benelux, Germany, Switzerland and Austria

Part of [the Europe plan](README.md). Proposed 2026-11-22; nothing built.

**How this was checked:**
- **Read at source:** many items, using the providers' own metadata APIs:
  - Belgium: transportdata.be, Infrabel;
  - the Netherlands: OVapi, decoded live;
  - Luxembourg: data.public.lu;
  - Germany: Mobilithek and the DB API Marketplace catalogue. DB InfraGO's network file was
    downloaded;
  - Switzerland: opentransportdata.swiss and data.sbb.ch;
  - Austria: data.oebb.at and the Mobilitätsverbünde catalogue.
- **Couldn't be opened from this session:** belgiantrain.be, ns.nl, the Dutch NDOV site (moved),
  `data.`/`api.opentransportdata.swiss`, bahnhof.de and download.gtfs.de. What depends on them is
  marked unverified.
- **Each country's first step,** its feed check ([plan-europe.md](../plan-europe.md), section 5),
  confirms the rest.

**Summary:**
- **The Netherlands:** open, keyless live data with platform changes.
- **Switzerland:** free keys, best documented, but tight quotas.
- **Germany:** works, with care: free live boards (terms to read), share-alike regional feeds, and
  excellent network data.
- **Luxembourg:** open timetables; its live key goes in the URL, which our rules forbid.
- **Belgium:** blocked until SNCB allows commercial use.
- **Austria:** timetables only.

## Netherlands (nl)

Europe/Amsterdam · Dutch · UIC 84.

**Verdict:** good. OVapi's GTFS and GTFS-Realtime cover every Dutch rail operator, with **platform
changes**, no key, CC0. Wave 2.

| | |
|---|---|
| Operators and tickets | NS (ns.nl); Arriva (arriva.nl); Blauwnet (Keolis/Arriva); R-net (NS, Qbuzz); RRReis (Arriva/Keolis); VIAS, eurobahn, Bentheimer Eisenbahn, GoVolta, European Sleeper, DB, NMBS. Ticket sites unverified |
| Timetables | OVapi `https://gtfs.ovapi.nl/nl/gtfs-nl.zip`, built from the national NDOV data (OVapi is one of the two official NDOV desks): every Dutch operator, all modes, rebuilt daily, valid to Dec 2027, **279 MB** (the build keeps rail only). Licence per table: timetables CC0, shapes ODbL, ticketing tables CC BY-NC-ND (don't use those). No registration: send a User-Agent that names us, `If-Modified-Since`, gzip. No service guarantee |
| Live delays, cancellations | OVapi `https://gtfs.ovapi.nl/nl/trainUpdates.pb` (also `tripUpdates`, `alerts`), regenerated every minute, no key |
| GPS | none open for trains (OVapi's vehicle positions had none on train trips). NS's "virtual train" API: unverified |
| Platforms | **yes**: OVapi's GTFS-RT extension carries `scheduled_track` and `actual_track` per stop (a snapshot had 21,740 planned and 272 changed) |
| Warnings | NS API disruptions (key; terms unverified). OVapi's alerts are mostly bus and tram |
| Planned works | NS API (unverified); no ProRail feed found |
| Lifts | none verified (SIRI-FM through NDOV: unverified) |
| Network and classification | ProRail on data.overheid.nl, CC BY 4.0, no key: track geometry (weekly), centrelines and km, overhead line (daily), train protection, level crossings. No maximum speed, so OpenStreetMap |
| Station ids | OVapi numeric `stop_id`; `zone_id` "IFF:<NS code>"; live data uses NS codes (asd, hn), so static and live match; IFOPT column |
| Cross-border | ICE Amsterdam–Frankfurt, Eurostar, IC Berlin and Brussels, VIAS, eurobahn, Arriva to Aachen and Leer; OVapi includes German stops |
| Storage | `/nl/` on R2: one national file (dense, but small) |
| Server | adapter `gtfsrt` on `trainUpdates.pb` every 60 s. It reads OVapi's track extension and writes our platform field |
| Registrations | none for OVapi. NS API portal (one key per product; some products need NS's approval) only for disruptions |
| Secrets | `NL_NS_API_KEY` (optional) |
| Risks | no service guarantee; ODbL shapes; NS's terms unread |

## Switzerland and Liechtenstein (ch, li)

Europe/Zurich · German, French, Italian, Romansh · UIC 85.

**Verdict:** excellent and well documented: every operator's timetable, live delays, alerts, planned
works and lift faults, with a free key. The quotas are tight. Wave 2.

| | |
|---|---|
| Operators and tickets | SBB (sbb.ch); BLS (bls.ch); SOB (sob.ch); RhB (rhb.ch); MGB, zb and others, also sold through SBB. Liechtenstein's line (Feldkirch–Buchs) is ÖBB's |
| Timetables | opentransportdata.swiss GTFS (also NeTEx, HRDF): all Swiss public transport for the timetable year, foreign stops included; new export every Monday and Thursday. Free, no registration for files; credit "opentransportdata.swiss"; companies may process and publish |
| Live delays, cancellations | GTFS-RT `https://api.opentransportdata.swiss/la/gtfs-rt` (cached 30 s, 3-hour window, every company with live data), free key (Bearer). Limit 2–5 calls a minute (the two pages disagree). Live data is tied to one GTFS version: switch both together, at 15:00 on export days |
| GPS | none: vehicle positions explicitly not published |
| Platforms | in the GTFS (`platform_code`, platform-level stops since 06/2025); live changes unverified |
| Warnings | GTFS-RT service alerts (`/la/gtfs-sa`); SIRI-SX (`/la/siri-sx-unplanned`, 2 a minute, 3,000 a day); SBB's rail traffic information (data.sbb.ch, every 5 min) |
| Planned works | SIRI-SX planned situations (`/la/siri-sx`, 10 an hour, 48 a day); works already in the GTFS calendars |
| Lifts | **yes**: lift faults come through SIRI-SX |
| Network and classification | data.sbb.ch (SBB's lines: geometry, gauge, km, tunnels, bridges). No speed or electrification, so OpenStreetMap; Switzerland keeps its own RINF |
| Station ids | didok/BPUIC 85xxxxx and SLOID (`ch:1:sloid:…`); GTFS stops are SLOID-based with a didok column |
| Cross-border | Basel SBB and Basel Bad Bf, Geneva and the Léman Express, TGV Lyria, ICE, EC to Italy, Railjet through Liechtenstein |
| Storage | `/ch/` on R2: national file plus regional files (dense network, many narrow-gauge lines) |
| Server | `gtfsrt` every 30–60 s (within the limit); `siri` for SIRI-SX unplanned every 60 s and planned every 30 min → notices, lifts included |
| Registrations | api-manager.opentransportdata.swiss (individuals or companies): one key per API; free under the limits, a paid contract above |
| Secrets | `CH_OTD_GTFSRT_KEY`, `CH_OTD_SIRISX_KEY` |
| Risks | tight limits; trip ids change with every export (rebuild Mondays and Thursdays) |

## Germany (de)

Europe/Berlin · German · UIC 80.

**Verdict:** feasible, and big. Open timetables and excellent open network data. For live data, the
free **DB OpenBoards** covers every main-line train, including platforms, if its terms allow our
use. DELFI's open feeds are share-alike and partial. Wave 3.

| | |
|---|---|
| Operators and tickets | DB Fernverkehr and DB Regio (bahn.de); FlixTrain (flixtrain.de); many regional operators (Transdev, National Express, Go-Ahead, metronom, NordWestBahn, ODEG, VIAS, eurobahn…), mostly sold through bahn.de and the transport associations' apps |
| Timetables | **DELFI national GTFS** (also NeTEx and the stop register), opendata-oepnv.de: all local transport plus long-distance rail, weekly (Mondays), now to 31 Mar 2027. CC BY, commercial use allowed; a free account |
| Live delays, cancellations | **DB OpenBoards** (DB API Marketplace): departures and arrivals of all main-line trains at German stations, with planned and forecast times, platforms, cancellations, extra stops, replacement trains and disruption texts. Free plan, 10 calls a second. Its terms are bahnhof.de's "Web Bahnhofstafel" terms (unread). Others: DELFI GTFS-RT (every minute, CC BY-SA, partial: regional rail, bus, tram); DELFI SIRI ET "Bahndaten" (every 5 min, CC BY-SA); gtfs.de's free feed (beta, CC BY-SA, third-party). DB's Timetables API is gone (22 Nov 2026), and long-distance actuals on Mobilithek and the RIS APIs are paid |
| GPS | none open |
| Platforms | OpenBoards |
| Warnings | OpenBoards' disruption texts; DELFI GTFS-RT alerts (only Bremen and Lower Saxony so far) |
| Planned works | none reusable: strecken.info (DB's works, 12 weeks) is on Mobilithek with "no licence" |
| Lifts | **yes**: FaSta (free, CC BY 4.0, key) and OpenStation SIRI-FM (CC0) |
| Network and classification | **DB InfraGO's infrastructure data** (Mobilithek, CC BY 4.0, twice a year, anonymous download; GeoPackage 63 MB). Streckennetz has electrification, track count and speed per direction with geometry, plus operating points (DS100), level crossings, bridges and tunnels. The best open network data found |
| Station ids | DELFI uses DHID/IFOPT (`de:…`); DB's APIs use EVA numbers (80xxxxx); InfraGO uses DS100. All three go in the crosswalk |
| Cross-border | ICE and EC to every neighbour; Basel Bad Bf (a DB station in Switzerland), Salzburg; the Swiss GTFS includes German stops |
| Storage | `/de/` on R2: a long-distance file plus one per Land; the biggest network in Europe (about twice the UK), so the regional split matters most here |
| Server | adapter `boards`: OpenBoards of about 1,000 main stations, each every 2–3 min, within 10 calls a second, → GTFS-RT. Decide between OpenBoards and DELFI's share-alike feeds once the terms are read. `lifts`: FaSta every 15 min |
| Registrations | opendata-oepnv.de (individuals allowed; project description) → username and password. Mobilithek account → subscriptions. DB API Marketplace (DB account; DB activates it, no one is entitled to one) → client id and key |
| Secrets | `DE_DELFI_USERNAME`, `DE_DELFI_PASSWORD`, `DE_DB_CLIENT_ID`, `DE_DB_API_KEY` |
| Risks | OpenBoards' terms unread; CC BY-SA share-alike on DELFI's live data (a lawyer should check what it forces on our derived data); FlixTrain's data restricted; size |

## Luxembourg (lu)

Europe/Luxembourg · Luxembourgish, French, German · UIC 82.

**Verdict:** open timetables. Live departures only through a HAFAS API whose key goes **in the URL**,
which AGENTS.md forbids for secrets. Ask ATP for a header instead, or the maintainer decides.
Wave 2, with France and Belgium.

| | |
|---|---|
| Operators and tickets | CFL (cfl.lu); SNCB, SNCF TER and DB across the borders; journey planner mobiliteit.lu |
| Timetables | Administration des transports publics on data.public.lu, no registration: GTFS (weekly, CC BY, about 16 MB) and NeTEx (CC0, about 34 MB). The current files end 12 Dec 2026 |
| Live delays, cancellations | mobiliteit.lu's HAFAS API (`cdt.hafas.de/opendata/apiserver/departureBoard`), CC BY, key by email from ATP, sent as the `accessId` URL parameter; quotas not stated. No GTFS-RT or SIRI |
| GPS | none open |
| Platforms | through HAFAS (fields unverified) |
| Warnings, works, lifts | none open found |
| Network and classification | INSPIRE train network on data.public.lu (CC0), plus OpenStreetMap |
| Station ids | HAFAS ids (e.g. 200426002); match with the GTFS unverified |
| Storage | `/lu/` on R2, small |
| Server | adapter `hafas-board` for the main stations every 60 s, if the key question is solved |
| Registrations | email ATP (opendata-api@atp.etat.lu) → a personal key |
| Secrets | `LU_ATP_API_KEY` (see the URL problem above) |
| Risks | the key in the URL; quotas unstated |

## Belgium (be)

Europe/Brussels · Dutch, French, German · UIC 88.

**Verdict:** blocked on SNCB. Its GTFS and GTFS-Realtime need a key, and the national access point
marks them **non-commercial**; SNCB's FAQ forbids redistributing the raw data. Ask SNCB for
commercial use in writing. Eurostar's feeds and Infrabel's network data are open.

| | |
|---|---|
| Operators and tickets | SNCB/NMBS (belgiantrain.be); Eurostar, including the former Thalys (eurostar.com); DB ICE (bahn.de); European Sleeper; NS's Brussels–Amsterdam IC |
| Timetables | SNCB GTFS and NeTEx through the access point (transportdata.be; `data.belgianmobility.io`, key in the `Ocp-Apim-Subscription-Key` header), daily, **non-commercial**. Eurostar GTFS, Licence Ouverte 2.0, no key |
| Live delays, cancellations | SNCB GTFS-RT (every 30 s, key, same non-commercial flag); Eurostar GTFS-RT (open). iRail is a community API (unofficial) |
| GPS | none open |
| Platforms | Eurostar's GTFS-RT; SNCB's unverified |
| Warnings | SNCB GTFS-RT alerts (key) |
| Planned works | **Infrabel's long-term capacity restrictions** (`langetermijnplanning-tcr-spoornetwerk`, from 6 months ahead, CC0, no key); nothing short-term |
| Lifts | none open |
| Network and classification | **Infrabel open data** (101 datasets, CC0, no key): line sections with electrification, track count and loading gauge; tracks; operating points; ETCS; platform heights. No maximum speed, so OpenStreetMap |
| Station ids | SNCB 7-digit UIC 88xxxxx; Infrabel's PTCAR ids and TAF/TAP codes (crosswalk) |
| Cross-border | Eurostar (London, Paris, Amsterdam, Cologne), ICE to Frankfurt, IC to Amsterdam, Luxembourg, Lille, Maastricht, Aachen; OVapi's Dutch GTFS includes SNCB trains |
| Storage | `/be/` on R2: one national file |
| Server | `gtfsrt` on SNCB's feed every 30–60 s, once allowed |
| Registrations | the access point's account → subscription key. A letter to SNCB for commercial use |
| Secrets | `BE_SNCB_KEY` |
| Risks | the non-commercial flag; belgiantrain.be blocks automated reading |

## Austria (at)

Europe/Vienna · German · UIC 81.

**Verdict:** timetables only. There is no official open live data (ÖBB's HAFAS is unofficial), so
trains go by timetable unless ÖBB agrees. Wave 4.

| | |
|---|---|
| Operators and tickets | ÖBB (tickets.oebb.at); WESTbahn (westbahn.at); Raaberbahn/GySEV; Montafonerbahn; regional railways (GKB, StLB, SLB, Zillertalbahn) |
| Timetables | Mobilitätsverbünde Österreich "Fahrplandaten Eisenbahn (GTFS)" (data.mobilitaetsverbuende.at): ÖBB, Raaberbahn, Montafonerbahn, WESTbahn, ÖGEG; updated continuously (80 MB, timetable 2027); its own data licence (commercial use reportedly allowed with credit; terms unread); free account. ÖBB's GTFS on data.oebb.at: CC BY 4.0, but only once a year |
| Live delays, cancellations | none open. data.oebb.at has a historical "Zugfahrten" CSV (cancellations, delays), at least weekly: useful for statistics, not live |
| GPS, platforms, warnings, lifts | none open |
| Planned works | infrastruktur.oebb.at's construction pages per state (HTML) |
| Network and classification | ÖBB-Infrastruktur on data.oebb.at: lines, km, stations, level crossings and tunnels with single or multiple track (CC BY 3.0 AT, monthly). "Geo Netz" carries NeTEx, IFOPT, EVA, DB640 and primary location codes for every junction: **a ready-made crosswalk**. No speed or electrification, so OpenStreetMap plus RINF |
| Station ids | see Geo Netz; GTFS ids' relation unverified |
| Cross-border | Railjet and Nightjet to Germany, Switzerland, Italy, Hungary, Czechia, Slovakia; Salzburg and Kufstein shared with DB; Feldkirch–Buchs through Liechtenstein. MVO warns that foreign stops may be missing |
| Storage | `/at/` on R2: one national file |
| Server | none, until ÖBB agrees |
| Registrations | MVO account → username and password. A letter to ÖBB for live data |
| Secrets | `AT_MVO_USERNAME`, `AT_MVO_PASSWORD` |
| Risks | no live data; MVO's licence text unread |
