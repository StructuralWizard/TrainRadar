# Europe, country by country

Part of [plan-europe.md](../plan-europe.md) (the architecture). Proposed 2026-11-22.

**Built so far:** Ireland (timetable and live delays), France (timetable and live delays) and
Luxembourg (timetable), each a hidden country behind its `<CC>_ENABLED` variable.

## The plans

| File | Countries |
|---|---|
| [pt.md](pt.md) | Portugal |
| [ie.md](ie.md) | Ireland |
| [fr.md](fr.md) | France (and Monaco) |
| [west-central.md](west-central.md) | Netherlands, Switzerland and Liechtenstein, Germany, Luxembourg, Belgium, Austria |
| [south-north.md](south-north.md) | Finland, Norway, Sweden, Denmark, Italy, Estonia, Latvia, Lithuania |
| [east.md](east.md) | Poland, Czechia, Slovakia, Hungary, Slovenia, Croatia, Romania, Greece, and briefly Bulgaria, the Balkans, Moldova, Ukraine and Turkey |

Each country covers the same ground:
- operators and where they sell tickets;
- timetables, live delays, GPS and platforms;
- warnings, planned works and lifts;
- the network and its classification;
- station ids;
- storage and the server;
- registrations and secrets;
- risks.

**How this was researched (22 Nov 2026):**
- Six research agents worked in parallel.
- **Checked at source:**
  - wave 1, and much of the Benelux, Germany, Switzerland and Austria;
  - files downloaded, live feeds called, the providers' catalogues read.
- **The rest:** search results restricted to official sites, and the providers' public repositories.

Each file says which. Nothing is built on a source until that country's feed check has confirmed it.

## Where each country stands

"open" means usable commercially without a key. "key" means free with registration. "permission"
means we need written permission first.

| Country | Timetables | Live delays | GPS | Platforms | Warnings | Planned works | Lifts | What blocks it | Wave |
|---|---|---|---|---|---|---|---|---|---|
| Ireland | open (3 weeks ahead) | key | — | — | key | in the timetable | web only | — | 1 |
| France | open | open (Paris: key) | — | open | open, 6 languages | in alerts | open, hourly | ODbL conditions | 1 |
| Portugal | **no licence** | — | — | — | web only | PDF | — | CP's permission | 1 |
| Netherlands | open | open | — | open, with changes | key (NS) | key (NS) | — | — | 2 |
| Switzerland | open | key | — | in the timetable | key | key | key | tight quotas | 2 |
| Finland | open | open | **open** | open | open | open | — | — | 2 |
| Norway | open | open | **open** | open | open | open | — | — | 2 |
| Luxembourg | open | key (in the URL) | — | key | — | — | — | the key in the URL | 2 |
| Germany | account | free key (OpenBoards) | — | key | key | none reusable | key | OpenBoards' terms; share-alike | 3 |
| Sweden | key | key | partial | key | key | key | — | quotas | 3 |
| Denmark | registration | registration | — | probably | — | — | — | MitID login | 3 |
| Poland | key | key | — | planned only | key | PDF | — | terms unread | 3 |
| Belgium | key, **non-commercial** | key, **non-commercial** | — | unverified | key | open (long-term) | — | SNCB's permission | 3 |
| Hungary | registration | registration (probably) | maybe | — | web | web | — | terms unknown | 4 |
| Austria | account; open once a year | — | — | — | — | web | — | no live data | 4 |
| Czechia | open (NeTEx) | — | — | — | web | web | — | no live data; NeTEx reader | 4 |
| Slovakia | open, maybe stale | forbidden | — | — | web | web | — | no live data | 4 |
| Slovenia | access point (terms?) | planned | — | — | web | web | — | terms | 4 |
| Croatia | **no licence** | — | — | — | web | web | — | permission | 4 |
| Romania | open (yearly XML) | — | — | — | — | — | — | no live data; XML reader | 4 |
| Estonia | open (informal) | — | — | — | — | web | — | no live data | 4 |
| Latvia | open, maybe stale | — | — | — | — | — | — | freshness | 4 |
| Lithuania | to check | to check | — | — | — | — | — | rail coverage | 4 |
| Italy | regional only | — | — | — | RSS | RSS | web | no national data | later |
| Greece | none | — | web only | — | web | web | — | no timetable | later |
| Bulgaria, Serbia, Bosnia, Montenegro, North Macedonia, Albania, Kosovo, Moldova, Ukraine, Turkey | little or none | — | — | — | — | — | — | no data | later |

## Order

The waves below are built as about seven grouped merges (M1–M7), listed in
[registrations.md](registrations.md#the-merges).

1. **Wave 1, as asked:**
   - **Ireland first:** official live delays, in English, and joined to Northern Ireland.
   - **France next:** the best open data, and the most cross-border trains.
   - **Portugal** as soon as CP gives permission. Write to CP now.
2. **Wave 2:** open live data with no key or a free one.
   - The Netherlands, Switzerland, Finland and Norway.
   - Luxembourg, alongside France and Belgium.
   - Finland and Norway also have real GPS, the app's strongest feature.
3. **Wave 3:** keys, quotas, terms to read, or a permission:
   - Germany, the biggest;
   - Sweden, Denmark and Poland;
   - Belgium, once SNCB allows commercial use.
4. **Wave 4:** timetables only, unless the letters bring live data.
   - Austria, Hungary, Czechia (after the NeTEx reader), Slovakia, Slovenia, Croatia, Romania (after
     its XML reader) and the Baltic states.
5. **Later:** Italy (until Trenitalia's data is open or agreed), Greece, Bulgaria and the rest. Check
   again each year: the EU rules require real-time data on national access points by 2025–2028.

## Registrations, passwords and secrets

Step-by-step instructions, with each GitHub name and the grouped merges: [registrations.md](registrations.md).

Every account is opened by Metranos Ltd with a shared company mailbox. Every secret is approved by
the maintainer before it's added, and listed in AGENTS.md ([plan-europe.md](../plan-europe.md),
A10).

**Already approved:**
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`;
- `NAP_API_KEY` (Spain, OUIGO's timetable; missing from AGENTS.md's list);
- `NETWORK_RAIL_USERNAME`, `NETWORK_RAIL_PASSWORD` and `NATIONAL_RAIL_KB_KEY` (UK).

**Proposed:**

| Country | Account | It gives | Secret |
|---|---|---|---|
| Ireland | NTA developer portal (automatic approval) | API key | `IE_NTA_API_KEY` |
| France | IDFM PRIM (Île-de-France live data) | API key | `FR_IDFM_PRIM_KEY` |
| France | data.gouv.fr, only if we must republish a derived timetable | API key | `FR_DATAGOUV_API_KEY` |
| Netherlands | NS API portal (optional: disruptions) | key per product | `NL_NS_API_KEY` |
| Switzerland | api-manager.opentransportdata.swiss | one key per API | `CH_OTD_GTFSRT_KEY`, `CH_OTD_SIRISX_KEY` |
| Norway | Bane NOR API portal (optional) | subscription key | `NO_BANENOR_KEY` |
| Luxembourg | email to ATP | key, sent in the URL (needs a decision) | `LU_ATP_API_KEY` |
| Germany | opendata-oepnv.de (DELFI timetable) | username and password | `DE_DELFI_USERNAME`, `DE_DELFI_PASSWORD` |
| Germany | DB API Marketplace (OpenBoards, FaSta) | client id and key | `DE_DB_CLIENT_ID`, `DE_DB_API_KEY` |
| Sweden | Trafiklab | key per project | `SE_TRAFIKLAB_KEY` |
| Sweden | Trafikverket | key | `SE_TRAFIKVERKET_KEY` |
| Denmark | Dataudveksleren (MitID login) | to confirm | `DK_NAP_…` |
| Poland | PKP PLK open data | API key | `PL_PLK_API_KEY` |
| Belgium | Belgian access point | subscription key | `BE_SNCB_KEY` |
| Austria | Mobilitätsverbünde Österreich | username and password | `AT_MVO_USERNAME`, `AT_MVO_PASSWORD` |
| Hungary | MÁV's GTFS form | to confirm | `HU_MAV_…` |
| All (travellers' reports) | Google Cloud project linked to Play | service-account credential | `PLAY_INTEGRITY_CREDENTIALS` |

**No secret, but a header that names us:**
- Finland (`Digitraffic-User`);
- Norway (`ET-Client-Name`);
- the Netherlands (OVapi's User-Agent).

Use a generic client name and the company's contact address.

**Letters asking for permission or for live data:**
- Portugal (CP, IP);
- Ireland (the NTA's fair-use clause; Irish Rail's API);
- Belgium (SNCB);
- Austria (ÖBB);
- Czechia (SŽ), Slovakia (ŽSR), Hungary (MÁV), Romania (ARF/Infofer), Croatia (HŽPP);
- Estonia (Elron);
- Italy (Trenitalia, RFI);
- Greece (Hellenic Train, the Ministry).

## Pan-European building blocks

- **Line attributes:** ERA's register of infrastructure (RINF) and its knowledge graph.
  - What: maximum speed, contact line and voltage, gauge, ETCS and track count per line, for EU
    infrastructure managers and Norway.
  - How: a public SPARQL endpoint (`graph.data.era.europa.eu/repositories/rinf-plus`), and CC BY 4.0
    dumps on Zenodo.
  - Limits: no high-speed flag; not the UK or Northern Ireland; quality varies by country. Used to
    fill in OpenStreetMap's track, not to replace it.
- **One id per station:** Trainline's open station list (`github.com/trainline-eu/stations`, ODbL,
  maintained), with UIC codes and operators' ids. It seeds the crosswalk
  ([plan-europe.md](../plan-europe.md), A3).
- **What national access points must hold** (EU Delegated Regulation 2017/1926 as amended by
  2024/490):
  - Static timetables in NeTEx.
  - Real-time data in SIRI (delays, cancellations, disruptions, and platform and lift status):
    - on the main TEN-T network since December 2025;
    - on the rest by December 2028.
  - Being on an access point doesn't make data openly licensed.
  - The official list of access points is on the European Commission's site
    (`transport.ec.europa.eu`, "National Access Points").
- **Finding feeds:**
  - Transitous (CC0), the Mobility Database (CC0) and Transitland's Atlas (CC BY 4.0).
  - Good for finding feeds, not authoritative: licences are often missing, and some entries are
    community copies of unofficial sources, which we never use.
  - Always confirm the producer and licence on the official page.
- **No pan-European live data.** RailNetEurope's train information system is closed to the public.
  Eurostar publishes open timetables and live data (Licence Ouverte 2.0).
- **Planned works.** EU rules require infrastructure managers to announce large works in their
  network statements, up to 24 months ahead for the biggest. RailNetEurope's works tool needs a
  login. So works come country by country; Belgium's Infrabel publishes its long-term plan as open
  data.
- **OpenStreetMap:**
  - Track and its tags: `usage`, `highspeed`, `maxspeed`, `electrified`, `voltage`, `frequency`,
    `gauge`, `tracks`, `railway:traffic_mode`.
  - Our track is a derived database, offered under the ODbL with the credit "© OpenStreetMap
    contributors".
  - OpenRailwayMap's tiles aren't allowed in apps with a paid tier, so we keep drawing our own.
- **Lift status:** no pan-European source yet. National sources (France, Germany, Switzerland, the
  Netherlands, Great Britain) and the access points' obligations cover it bit by bit.
