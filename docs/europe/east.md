# Central and south-eastern Europe

Part of [the Europe plan](README.md). Proposed 2026-11-22; nothing built.

**How this was checked:** this session's network couldn't open the official pages directly. Facts
come from search results restricted to each official site, and a few from public repositories. Each
country's first step, its feed check (see [plan-europe.md](../plan-europe.md), section 5), confirms
them before anything is built. "Unverified" marks what couldn't be confirmed even that way.

**Summary:**
- **Official real-time data:** only Poland has a national real-time API (PKP PLK, which covers
  every operator).
- **Open timetables only:** Czechia, Slovakia, Hungary, Croatia, Romania and Slovenia.
- **No machine-readable timetable at all:** Greece.
- **The live maps** in Czechia, Slovakia, Romania and Greece are web-only. Using them needs a
  written agreement. Without one, trains are placed by timetable and labelled as such.
- **Network data:** no infrastructure manager here publishes reusable network data, so track comes
  from OpenStreetMap. Line speed, electrification and gauge come from ERA's register of
  infrastructure (RINF) where it covers them (see README).

## Poland (pl)

Europe/Warsaw · Polish · UIC 51.

**Verdict:** feasible. PKP PLK's open API gives timetables, live delays and disruptions for every
operator on its network. Before building, we need the key and its terms read.

| | |
|---|---|
| Operators and tickets | PKP Intercity (intercity.pl); Polregio (polregio.pl); Koleje Mazowieckie (mazowieckie.com.pl); SKM Trójmiasto (skm.pkp.pl); Koleje Śląskie (kolejeslaskie.pl); Koleje Dolnośląskie (kolejedolnoslaskie.pl); ŁKA (lka.lodzkie.pl); Koleje Wielkopolskie; Koleo (koleo.pl) sells for several operators |
| Timetables | **PKP PLK "Otwarte Dane Kolejowe"**, `https://pdp-api.plk-sa.pl/`, JSON: `/api/v1/schedules` holds every passenger train of every operator on PLK's network, up to 31 days per query. Also stations, carriers, and a data version that changes with the data. Free, with a key. Operator GTFS too (Polregio, SKM Trójmiasto, Koleje Dolnośląskie; PKP Intercity over FTP), each with its own stop ids |
| Live delays, cancellations | PLK `/api/v1/operations`: actual times and delay per station, up to 10,000 records a page, polled. Koleje Dolnośląskie also has GTFS-RT for its own trains |
| GPS | none open nationally (the Portal Pasażera map has no API). Koleje Dolnośląskie's GTFS-RT covers its own trains. Elsewhere, by timetable plus delay |
| Platforms | planned platform and track in `/schedules` (sometimes empty); no live changes |
| Warnings | PLK `/api/v1/disruptions` (current; filter by station and operator) |
| Planned works | PLK's yearly track-closure plans as PDFs; replacement buses in operators' notices (HTML). Unverified: whether `/disruptions` includes planned closures |
| Lifts | none open |
| Network and classification | PLK's line map (speeds, electrification, tracks, gauge) is for personal or internal use only, so OpenStreetMap, plus RINF |
| Station ids | PLK's numeric station ids (e.g. Kraków Główny 80416), the same in schedules, operations and disruptions. Operator GTFS must be matched by name and position |
| Storage | `/pl/` on R2: a national long-distance file plus regional files by voivodeship. Track from Geofabrik `europe/poland` (2.0 GB) |
| Server | adapter `plk`: `/operations` every 30–60 s, a few pages each time. That is ~3,000–9,000 calls a day, so it needs the Standard or Premium quota. `/disruptions` every 5 min goes into notices |
| Registrations | PLK API: web form; the key is assigned to the organisation (Metranos Ltd); approval in 3–5 working days; accept "Regulamin v1.0" (read it first: PLK may charge for real-time access). PKP Intercity's FTP account only if its GTFS adds something |
| Secrets | `PL_PLK_API_KEY` (sent in the `X-API-Key` header) |
| Risks | the terms are unread; quotas (HTTP 429 above them); PLK changes v1 without notice, though only in ways that don't break clients; PLK's data stops at the border |

## Czechia (cz)

Europe/Prague · Czech · UIC 54.

**Verdict:** timetables yes (NeTEx), live data no. Trains go by timetable until Správa železnic
agrees to share its real-time data.

| | |
|---|---|
| Operators and tickets | České dráhy (cd.cz); RegioJet (regiojet.cz); Leo Express (leoexpress.com); Arriva vlaky (arriva.cz); regional operators (GW Train Regio, Die Länderbahn/Trilex, AŽD, KŽC) |
| Timetables | **CIS JŘ** (the national timetable system; Ministry of Transport) publishes NeTEx (European profile) at `https://portal.cisjr.cz/pub/netex/`: every passenger train of every operator on SŽ's network, one ZIP per timetable year plus monthly updates. Updated Monday, Wednesday and Friday. No registration. The Ministry says commercial use is allowed, but there's no formal licence text. The station and line lists on data.gov.cz are CC BY 4.0 |
| Live delays, cancellations | none open. GRAPP (SŽ's live map) has no API or licence |
| GPS | none open |
| Platforms | none found. Unverified: whether the NeTEx has tracks |
| Warnings | SŽ's map, operations portal and Datel app: web and app only |
| Planned works | the same channels, HTML only |
| Lifts | none open |
| Network and classification | SŽ's Geoportál DTMŽ is in a pilot, with data on request and no licence found. Line speeds are in the network statement (PDF). So OpenStreetMap, plus RINF |
| Station ids | SR70 station numbers (CC BY 4.0 list) |
| Storage | `/cz/` on R2: a dense network, so a national long-distance file plus regional files. Track from Geofabrik `europe/czech-republic` |
| Server | no live adapter. A notices adapter only if SŽ offers a feed |
| Registrations | none for CIS JŘ. Ask SŽ (and OLTIS, which runs GRAPP) for a real-time data agreement |
| Secrets | none for now |
| Risks | **needs the NeTEx reader** (plan-europe A4); the licence is only a statement by the Ministry, so get it confirmed in writing; CIS JŘ is due to be replaced |

## Slovakia (sk)

Europe/Bratislava · Slovak · UIC 56.

**Verdict:** a CC0 GTFS that may be out of date; no live data (ŽSR forbids reusing its live
map).

| | |
|---|---|
| Operators and tickets | ZSSK (zssk.sk); RegioJet (regiojet.sk); Leo Express (leoexpress.com) |
| Timetables | ŽSR GTFS `https://www.zsr.sk/files/pre-cestujucich/cestovny-poriadok/gtfs/gtfs.zip` (on data.gov.sk): every passenger train in Slovakia, CC0, no registration. Catalogues last saw it valid 7 Apr 2025 to 13 Mar 2026; check it's current |
| Live delays, cancellations | none open. ŽSR's map and its train-movement pages forbid automated downloading for third parties |
| GPS | none open |
| Platforms | none open |
| Warnings | ZSSK's notices (HTML) |
| Planned works | `zssk.sk/vyluky/` (HTML, including replacement buses) |
| Lifts | none open |
| Network and classification | network statement (PDF) only, so OpenStreetMap, plus RINF |
| Station ids | unverified |
| Storage | `/sk/` on R2, one national file |
| Server | none, until there's an agreement with ŽSR |
| Registrations | none. Ask ŽSR for a data agreement |
| Secrets | none |
| Risks | the GTFS may be stale; live data is explicitly off limits |

## Hungary (hu)

Europe/Budapest · Hungarian · UIC 55.

**Verdict:** promising. MÁV gives GTFS, and apparently GTFS-RT, after registration; the terms are
unknown.

| | |
|---|---|
| Operators and tickets | MÁV Személyszállítás (mavcsoport.hu, MÁV app); GYSEV (gysev.hu); MÁV-HÉV (Budapest suburban) |
| Timetables | MÁV GTFS, free, requested through `mavcsoport.hu/gtfs-igenybejelento` (choose rail, bus or both). Unverified: GYSEV and HÉV coverage, and the licence. National access point: napportal.kozut.hu |
| Live delays, cancellations | MÁV's privacy notices describe a "GTFS and GTFS-RT planned and actual timetable data service", so GTFS-RT exists, presumably with the same registration. Unverified: endpoint, refresh, quotas, terms |
| GPS | trains report GPS (shown on MÁV's maps). Open only if MÁV's GTFS-RT has vehicle positions (unverified) |
| Platforms | none found |
| Warnings | MÁVINFORM (HTML) |
| Planned works | MÁV's track-closure news and GYSEV's archive (HTML with PDF notices) |
| Lifts | none open |
| Network and classification | OpenStreetMap, plus RINF |
| Station ids | unverified |
| Storage | `/hu/` on R2, one national file plus Budapest's suburban network |
| Server | adapter `gtfsrt` on MÁV's feed, if the terms allow it |
| Registrations | MÁV's online form (who can register and what credential it gives: unverified) |
| Secrets | probably `HU_MAV_GTFS_KEY` (name once known) |
| Risks | unknown terms; MÁV switched its live map off in 2025 and back on |

## Slovenia (si)

Europe/Ljubljana · Slovenian · UIC 79.

**Verdict:** timetables through the national access point; live data planned there, not yet.

| | |
|---|---|
| Operators and tickets | Slovenske železnice – Potniški promet (potniski.sz.si) |
| Timetables | national access point `www.nap.si`: buses and all passenger trains, daily. A GTFS has been there since about 2022, and the system also produces NeTEx and SIRI. Unverified: download address, licence, registration |
| Live delays, cancellations | none open. The access point says dynamic data is moving to GTFS-Realtime (status unverified) |
| GPS | none open |
| Platforms | none open |
| Warnings | SŽ's status page (HTML) |
| Planned works | SŽ's pages on replacement buses and construction works (HTML) |
| Lifts | none open |
| Network and classification | OpenStreetMap, plus RINF |
| Station ids | unverified |
| Storage | `/si/` on R2, small |
| Server | none yet. `gtfsrt` once the access point publishes it |
| Registrations | none identified |
| Secrets | none |
| Risks | terms unknown; poor punctuality (18 % on time in 2025) and heavy works, so timetable positions will often be off |

## Croatia (hr)

Europe/Zagreb · Croatian · UIC 78.

**Verdict:** a daily GTFS with no clear licence. Ask HŽPP for written permission; no live data.

| | |
|---|---|
| Operators and tickets | HŽ Putnički prijevoz (hzpp.hr) |
| Timetables | HŽPP GTFS on hzpp.hr and data.gov.hr: domestic, international and Zagreb suburban trains, refreshed daily at 01:00, no registration. Licence unclear ("no licence" on data.gov.hr, CC BY on an older mirror) |
| Live delays, cancellations | none open |
| GPS | the HŽPP Planer app shows GPS for some trains; no open feed |
| Platforms | none open |
| Warnings | `hzpp.hr/hr/informacije?type=info` (HTML) |
| Planned works | `hzpp.hr/hr/informacije?type=works` (HTML) |
| Lifts | none open |
| Network and classification | OpenStreetMap, plus RINF |
| Station ids | unverified (HŽ Infrastruktura uses UIC numbers internally) |
| Storage | `/hr/` on R2, small |
| Server | none |
| Registrations | none. Ask HŽPP for written permission |
| Secrets | none |
| Risks | no licence |

## Romania (ro)

Europe/Bucharest · Romanian · UIC 53.

**Verdict:** yearly XML timetables under an open licence. Live data needs an agreement with ARF or
Informatica Feroviară.

| | |
|---|---|
| Operators and tickets | CFR Călători (cfrcalatori.ro); Regio Călători; Astra Trans Carpatic; Transferoviar Călători; InterRegional Călători; Softrans. `bilete.infofer.ro` sells for several operators |
| Timetables | data.gov.ro "Mers tren" per operator, XML, one timetable a year (Dec–Dec). The 2025–26 files are from 8 Dec 2025; 2026–27 (from 13 Dec 2026) not yet seen; Transferoviar's newest is 2018–19. Licence OGL-ROU-1.0 (credit "Conține informații publice în baza Licenței pentru Guvernare Deschisă v1.0"), which appears to allow commercial reuse. No registration |
| Live delays, cancellations | none open. The official map `bilete.infofer.ro/ro-RO/Trains` has no API |
| GPS | none open |
| Platforms | none open |
| Warnings | operators' sites only |
| Planned works | none open |
| Lifts | none open |
| Network and classification | CFR SA's network statement (PDF), so OpenStreetMap, plus RINF |
| Station ids | Infofer station codes in the XML (unverified) |
| Storage | `/ro/` on R2, one national file |
| Server | none, until there's an agreement |
| Registrations | none. Ask ARF or Infofer for a real-time agreement |
| Secrets | none |
| Risks | **a reader for the XML format**; yearly data only (mid-year changes unknown); some private operators missing |

## Greece (gr)

Europe/Athens · Greek · UIC 73.

**Verdict:** not feasible yet. There's no machine-readable timetable. Ask Hellenic Train for GTFS,
and the Ministry for access to railway.gov.gr's positions.

| | |
|---|---|
| Operators and tickets | Hellenic Train (hellenictrain.gr), the only operator: intercity, regional and Proastiakos |
| Timetables | none: the access point (data.nap.gov.gr) has only an old TrainOSE spreadsheet |
| Live delays, cancellations | Hellenic Train's updates page (HTML). railway.gov.gr (Ministry, since 25 Feb 2026) shows position, speed, ETA and delay, with no API or terms |
| GPS | railway.gov.gr has real satellite positions; no open feed |
| Platforms | none open |
| Warnings and works | Hellenic Train's announcements (HTML) |
| Lifts | none open |
| Network and classification | OpenStreetMap, plus RINF |
| Storage, server, secrets | none until there's data |
| Registrations | ask Hellenic Train (GTFS) and the Ministry (positions) |
| Risks | frequent disruption |

## Briefly

| Country | What there is | Verdict |
|---|---|---|
| Bulgaria (bg) · Europe/Sofia · UIC 52 | BDZ (bdz.bg); its timetable is on Google Maps and a GTFS is listed by Transitland (source and licence unverified); the access point `sipbg.gov.bg/bgnap` supports GTFS, GTFS-RT, NeTEx and SIRI | ask BDZ or the access point for the GTFS |
| Serbia (rs) · Europe/Belgrade · UIC 72 | Srbijavoz; no open rail data | a licence deal, or not yet |
| Bosnia and Herzegovina (ba) · Europe/Sarajevo | ŽFBiH and ŽRS; not researched | not yet |
| Montenegro (me) · Europe/Podgorica · UIC 62 | ZPCG (zpcg.me); PDF timetables only | not yet |
| North Macedonia (mk) · Europe/Skopje · UIC 65 | ŽRSM; a few domestic trains | not yet |
| Albania (al) · Europe/Tirane · UIC 41 | HSH; minimal service while lines are rebuilt | not yet |
| Kosovo (xk) · Europe/Belgrade | Trainkos; a few domestic lines | not yet |
| Moldova (md) · Europe/Chisinau · UIC 23 | CFM; nothing found | not yet |
| Ukraine (ua) · Europe/Kyiv · UIC 22 | Ukrzaliznytsia; only unofficial APIs | not without an agreement |
| Turkey, European part (tr) · Europe/Istanbul · UIC 75 | TCDD Taşımacılık (Marmaray); no GTFS found; no summer time | not yet |
