# Italy, the Nordic countries and the Baltic states

Part of [the Europe plan](README.md). Proposed 2026-11-22; nothing built.

**How this was checked:** this session's network couldn't open the official pages directly. Facts
come from:
- search results restricted to each official site;
- the providers' own public repositories:
  - Fintraffic's `tmfg/digitraffic-rail`;
  - Trafiklab's website source;
  - HSL's Digitransit documentation.

Each country's first step, its feed check (see [plan-europe.md](../plan-europe.md), section 5),
confirms them before anything is built. "Unverified" marks what couldn't be confirmed even that way.

**Summary:**
- **Finland and Norway** are ready now: open licences that allow commercial use, live delays and
  real GPS.
- **Sweden** works with free keys; the quotas matter.
- **Denmark's** open route is NeTEx and SIRI through its national access point, which asks for a
  Danish digital ID (MitID).
- **Italy:** regional timetables and RFI's notices only; no official live data.
- **The Baltic states:** timetables only.

## Finland (fi)

Europe/Helsinki (an hour ahead of Madrid) · Finnish, Swedish · UIC 10 · track gauge 1,524 mm.

**Built (M2, 2026-11-22):** `data/fi/` and `fi/rt/` behind `FI_ENABLED`, opened with
`?country=fi`.
- **Timetable:** Digitraffic's GTFS, platforms merged into stations, museum trains dropped. Two
  regions: `fi` (InterCity, Pendolino, night and regional trains) and `fi-l` (commuter lines).
- **Live:** GPS of every running train and its delays, every 30 s, through `backend-eu/`.
- **Checked:** every live trip id matched; 112 trains on GPS in the browser; Helsinki–Oulu and
  Turku–Joensuu journeys with changes.
- **Not yet:** platforms and notices (Digitraffic's JSON APIs).

**Verdict:** the best open rail data in Europe: timetables, live delays, GPS of every train,
platforms, notices and track works, with no key. Early wave.

| | |
|---|---|
| Operators and tickets | VR (vr.fi), including Helsinki's commuter trains (HSL tickets, hsl.fi) |
| Timetables | Digitraffic (Fintraffic): GTFS `https://rata.digitraffic.fi/api/v1/trains/gtfs-passenger.zip`, NeTEx, REST; rebuilt daily. CC BY 4.0, commercial use allowed; credit "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY". No registration |
| Live delays, cancellations | Digitraffic REST `live-trains`, GTFS-RT `/api/v1/trains/gtfs-rt-updates`, SIRI ET, MQTT push |
| GPS | **yes**: `/api/v1/train-locations/latest`, GTFS-RT `gtfs-rt-locations`, SIRI VM, MQTT |
| Platforms | `commercialTrack` on every timetable row, planned and actual |
| Warnings | `/api/v1/passenger-information/active`, SIRI SX |
| Planned works | track-work and traffic-restriction notifications (RUMA): `/api/v1/trackwork-notifications`, `/trafficrestriction-notifications` |
| Lifts | none open |
| Network and classification | Väylävirasto datasets (CC BY 4.0). It has made some rail infrastructure data non-public, removed from Digitraffic by the end of 2026, so use OpenStreetMap plus RINF |
| Station ids | short codes (HKI); GTFS stop id = code + track (HKI_5); SIRI uses the national stop register (FSR:Quay:…) |
| Storage | `/fi/` on R2, one national file (smaller than Spain's) |
| Server | adapter `gtfsrt` (trip updates and positions) every 15 s; a notices adapter for passenger information and track works every 5 min |
| Registrations | none. Every request carries a `Digitraffic-User` header (e.g. `Metranos/TrainRadar`); without it, Digitraffic throttles with HTTP 429 |
| Secrets | none |
| Risks | the infrastructure data being withdrawn (above) |

## Norway (no)

Europe/Oslo · Norwegian, Sámi · UIC 76.

**Built (M2, 2026-11-22):** `data/no/` and `no/rt/` behind `NO_ENABLED`, opened with
`?country=no`.
- **Timetable:** Entur's GTFS of the four rail operators (Vy, Go-Ahead Nordic, SJ Norge,
  Flytoget), merged and cut to trains by `tools/gtfs-rail.py` (the national file is 556 MB of every
  mode). Train numbers come from the trip ids.
- **Live:** Entur's national feeds filtered to those four (7,674 trip updates → about 1,640; 89 of
  1,359 vehicles; 37 of 209 alerts). Trains with GPS are drawn where they are; the others by
  timetable plus delay.
- **Checked:** 129 trains in the browser, 99 on GPS; Oslo–Bergen, Oslo–Trondheim journeys.

**Verdict:** excellent open data, NLOD licence, no key: timetables, delays, GPS, notices.
Early wave.

| | |
|---|---|
| Operators and tickets | Vy (vy.no); SJ Norge (sj.no); Go-Ahead Nordic (go-aheadnordic.no); Flytoget (flytoget.no); Entur (entur.no) sells for all |
| Timetables | Entur's national NeTEx (complete) and GTFS (a subset), published daily (`…/marduk-production/outbound/gtfs/rb_norway-aggregated-gtfs.zip` and the NeTEx zip). NLOD: commercial use allowed, credit "Inneholder data under NLOD tilgjengeliggjort av Entur AS". No key, but an `ET-Client-Name` header |
| Live delays, cancellations | Entur GTFS-RT `https://api.entur.io/realtime/v1/gtfs-rt/trip-updates` (and `vehicle-positions`, `alerts`), updated every 15 s; SIRI ET/VM/SX too. NLOD. Bane NOR also offers SIRI ET and SX through its API portal |
| GPS | **yes**: Entur vehicle positions (Vy's trains confirmed; SJ Norge and Go-Ahead unverified) |
| Platforms | NeTEx quays; SIRI ET |
| Warnings | SIRI SX / GTFS-RT alerts |
| Planned works | in SIRI SX |
| Lifts | none open |
| Network and classification | Bane NOR's network WFS (NLOD; reference lines). Bane NOR is in ERA's RINF graph, so speed and electrification come from there, on OpenStreetMap track |
| Station ids | the national stop register (NSR:StopPlace / NSR:Quay), the same in NeTEx, GTFS and SIRI |
| Storage | `/no/` on R2, one national file |
| Server | adapter `gtfsrt`: trip updates, positions and alerts every 15 s |
| Registrations | none. Bane NOR's portal key only if its SIRI adds something |
| Secrets | none (`NO_BANENOR_KEY` only if used) |
| Risks | the GTFS is a subset of the NeTEx; check that every train is in it, or use the NeTEx reader |

## Sweden (se)

Europe/Stockholm · Swedish · UIC 74.

**Verdict:** very good with free keys. Trafikverket's API covers every passenger train's planned and
actual times; the quotas need an upgrade. Early-to-middle wave.

| | |
|---|---|
| Operators and tickets | SJ (sj.se); MTR Express (mtrx.travel); Snälltåget (snalltaget.se); Norrtåg (norrtag.se); Mälartåg; Västtågen (vasttrafik.se); Öresundståg and Pågatåg (skanetrafiken.se); SL (sl.se); Tåg i Bergslagen; VR Sverige |
| Timetables | Trafiklab (Samtrafiken), CC0, with a key: GTFS Sweden 3 (detailed, not yet complete), GTFS Sverige 2 (every operator, less detail), GTFS Regional per operator. Trafikverket's `TrainAnnouncement` (planned and actual calls of passenger trains), CC0 |
| Live delays, cancellations | Trafikverket's open API `https://api.trafikinfo.trafikverket.se/v2/data.json` (an XML query; server-sent events available), CC0, key. GTFS-RT Sweden 3 per operator, CC0, key; quotas Bronze 50 calls a minute and 30,000 a month, Silver 2 million a month, Gold 22.5 million a month |
| GPS | Trafikverket's `TrainPosition` (coverage unverified); GTFS-RT vehicle positions for some operators; Oxyfi's WebSocket (1 Hz GPS for some regional trains; no licence stated) |
| Platforms | `TrackAtLocation` in `TrainAnnouncement` |
| Warnings | Trafikverket's `TrainMessage`; GTFS-RT service alerts |
| Planned works | `TrainMessage` |
| Lifts | none open |
| Network and classification | Trafikverket's national rail database (NJDB; CC0, download route unverified), and Sweden is in RINF. OpenStreetMap track |
| Station ids | Trafikverket's signatures (e.g. Cst) vs GTFS 7400xxxxx; Trafiklab publishes the mapping (`trafikverket_stops.txt`, no key) |
| Storage | `/se/` on R2: a national long-distance file plus regional files |
| Server | adapter `trafikverket`: changed `TrainAnnouncement`s (server-sent events, or polling every 30 s) → GTFS-RT; `TrainMessage` → notices |
| Registrations | Trafiklab account (keys per project; Silver or Gold on request, usually granted); Trafikverket account at data.trafikverket.se |
| Secrets | `SE_TRAFIKLAB_KEY`, `SE_TRAFIKVERKET_KEY` |
| Risks | quotas; GTFS Sweden 3 is incomplete, so merge it with Sverige 2 or Trafikverket's data |

## Denmark (dk)

Europe/Copenhagen · Danish · UIC 86.

**Verdict:** feasible through the national access point (NeTEx and SIRI-ET, free), but logging in
there needs MitID. Rejseplanen's API costs €5,000 a year for commercial use.

| | |
|---|---|
| Operators and tickets | DSB, including S-tog (dsb.dk); Arriva; Lokaltog (lokaltog.dk); Nordjyske and Midtjyske Jernbaner; Øresundståg; SJ; DB |
| Timetables | NeTEx through Dataudveksleren (the national access point, Vejdirektoratet), free after registration. Rejseplanen's GTFS (labs.rejseplanen.dk), "free on request", every ~14 days; commercial terms unverified |
| Live delays, cancellations | SIRI-ET through Dataudveksleren, free after registration. Rejseplanen API 2.0: €5,000 a year for commercial use |
| GPS | none open |
| Platforms | probably in SIRI-ET |
| Warnings | none open found |
| Planned works | Banedanmark's web pages only |
| Lifts | none open |
| Network and classification | Banedanmark's network statement annexes (no data licence), so OpenStreetMap plus RINF |
| Station ids | unverified |
| Storage | `/dk/` on R2, one national file |
| Server | adapter `siri` (SIRI-ET → GTFS-RT) |
| Registrations | Dataudveksleren profile, logged in with MitID: check whether a UK company can get one; otherwise ask Vejdirektoratet for another route. Rejseplanen Labs (request form, approval) only for its GTFS |
| Secrets | `DK_NAP_…` (the access point's credential, once known) |
| Risks | **needs the NeTEx reader**; the MitID barrier; Rejseplanen's API change on 25 Nov 2026 |

## Italy (it)

Europe/Rome · Italian · UIC 83.

**Update, Nov 2026:** Lombardy (Trenord, CC BY 4.0) is built, by timetable; the national access
point's catalogue needs a login (SPID). See [it.md](it.md), with the letter asking for access.

**Verdict:** not feasible to a good standard yet. There's no official national timetable or live data
for Trenitalia or Italo; only regional timetables and RFI's notices. Under the EU rules, Italy's
national access point owes real-time rail data, so check it again, or seek an agreement with
Trenitalia and RFI.

| | |
|---|---|
| Operators and tickets | Trenitalia (trenitalia.com); Italo (italotreno.com); Trenord (trenord.it); EAV (eavsrl.it); FSE (fseonline.it); Trenitalia Tper |
| Timetables | national access point `https://www.cciss.it/nap/mmtis/`: NeTEx (Italian profile) from regional access points, including some Trenitalia datasets (e.g. Lombardy); "not all APIs are open to the public"; licence unverified. Trenord GTFS (dati.lombardia.it, CC BY 4.0, no registration). No official national GTFS for Trenitalia or Italo |
| Live delays, cancellations | none open. ViaggiaTreno is unofficial, and Trenitalia took an app to court over its data in 2019 |
| GPS | none open |
| Platforms | none open |
| Warnings | RFI's RSS "Aggiornamenti in tempo reale" per region, no key (reuse terms unverified: ask RFI) |
| Planned works | RFI's RSS "Avvisi ai viaggiatori" and infomobilità page |
| Lifts | RFI's station pages (HTML; permission needed) |
| Network and classification | RFI's network statement PDFs (no open licence), so OpenStreetMap plus RINF |
| Station ids | no common open scheme |
| Storage, server | not until national data exists. An RSS → notices adapter is possible |
| Registrations | the access point's terms (unverified); a data agreement with Trenitalia and RFI |
| Secrets | none yet |
| Risks | no official national data; a history of litigation; a patchwork of regions |

## Estonia (ee)

**Built (M4, 2026-11-22): the timetable.** `data/ee/` behind `EE_ENABLED`, opened with
`?country=ee`. peatus.ee's GTFS is closed ("Rakendus on suletud"); the register's Elron feed is now
`eu-gtfs.remix.com/elron.zip` (publisher: Regionaal- ja Põllumajandusministeerium; listed as
official by the Mobility Database). 1,492 trips, by timetable.

Europe/Tallinn · Estonian · UIC 26 · track gauge 1,520 mm.

**Verdict:** timetables only (Elron). Trains by timetable; ask Elron about live data.

| | |
|---|---|
| Operators and tickets | Elron (elron.ee), which also sells through tickets to Riga |
| Timetables | the public transport register's open data (Ministry of Regional Affairs and Agriculture; peatus.ee), GTFS including a separate Elron feed, "freely available to anyone"; no explicit licence; no registration |
| Live delays, GPS, platforms, warnings, lifts | none open (Elron's live map has no feed) |
| Planned works | Elron's news (HTML) |
| Network and classification | OpenStreetMap |
| Cross-border | Valga/Valka; Elron's Tallinn–Tartu–Riga since 12 Jan 2026 |
| Storage | `/ee/` on R2, small |
| Server | none |
| Registrations | none. Ask Elron for written permission and about live data |
| Secrets | none |
| Risks | the GTFS address has moved before; informal licence wording |

## Latvia (lv)

**M4, 2026-11-22: not built.** ViVi's `vivi.lv/uploads/GTFS.zip` answers with a bot challenge
(HTTP 403, so CI couldn't download it either), and the road agency's national GTFS (`atd.lv`)
closed the connection. Ask ViVi for a direct link.

Europe/Riga · Latvian · UIC 25 · track gauge 1,520 mm.

**Verdict:** timetables only, and possibly stale.

| | |
|---|---|
| Operators and tickets | Pasažieru vilciens, "ViVi" (vivi.lv); LTG Link; Elron |
| Timetables | GTFS on data.gov.lv (CC0, maintained by ViVi; last changed Nov 2024 / Feb 2025); ViVi's own GTFS link on vivi.lv; national access point data.lvceli.lv |
| Live delays, GPS, platforms, warnings, works, lifts | none open |
| Network and classification | OpenStreetMap |
| Storage | `/lv/` on R2, small |
| Server, registrations, secrets | none |
| Risks | freshness |

## Lithuania (lt)

**M4, 2026-11-22: no trains in the open data.** visimarsrutai.lt's national GTFS
(`google_transit.zip`) and the intercity file (`LTSAR.zip`) hold buses and trolleybuses only. Ask
LTG Link.

Europe/Vilnius · Lithuanian · UIC 24 · track gauge 1,520 mm (Rail Baltica 1,435 mm, being built).

**Verdict:** to check. A national GTFS exists; it's unclear whether LTG Link's trains are in it.

| | |
|---|---|
| Operators and tickets | LTG Link (ltglink.lt) |
| Timetables | national GTFS `https://www.visimarsrutai.lt/gtfs/` (state-run, free, no licence stated); whether it includes rail is unverified |
| Live delays | visimarsrutai.lt has GTFS-RT (rail coverage and terms unverified) |
| GPS, platforms, warnings, works, lifts | none open found |
| Network and classification | LTG Infra's network statements (PDF), so OpenStreetMap |
| Cross-border | Riga; Warsaw via Mockava |
| Storage | `/lt/` on R2, small |
| Server | `gtfsrt` if the feed covers rail |
| Registrations, secrets | none |
