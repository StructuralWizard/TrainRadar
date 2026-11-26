# Portugal (pt)

Part of [the Europe plan](README.md), wave 1. Proposed 2026-11-22.

**Built 2026-11-26, offered from 3.3: Lisbon only.** Fertagus (CC BY 4.0) and Lisbon Metro (dados.gov.pt,
CC BY), merged as region `pt-lis`, by timetable (`tools/fetch-eu.sh pt-lis`, `PT_ENABLED`). CP's
national timetable is wired (`tools/fetch-eu.sh pt`, region `pt`) but only built with
`PT_CP_ENABLED`, which stays off until CP gives written permission: its licence was still "No
licence" on 2026-11-26.

Checked 2026-11-22: the CP and Fertagus GTFS files were downloaded and inspected, and the pages
below were read at source.

## Summary

| | |
|---|---|
| **Operators** | CP – Comboios de Portugal runs almost everything: Alfa Pendular, Intercidades, InterRegional, Regional, the Lisbon, Porto and Coimbra suburban trains, and the Celta with Renfe. Fertagus runs Lisbon–Setúbal across the 25 de Abril bridge |
| **Timetables** | Complete and current (CP's runs to Dec 2027). But **CP's has no licence** |
| **Live data** | **None official.** No delays, cancellations, platforms or GPS |
| **Warnings, works, lifts** | Web pages and PDFs only; nothing machine-readable, strikes included |
| **Verdict** | **Blocked until CP gives written permission** to reuse its timetable commercially. With it: trains placed by timetable and labelled as such, as OUIGO's are today. Ask CP and Infraestruturas de Portugal (IP) for live data at the same time |

The EU's MMTIS rules require Portugal's national access point to hold real-time rail data for the
main (TEN-T) network since December 2025 ([README](README.md#pan-european-building-blocks)). That
is a fair point to make in the request.

## Timetables

- **CP GTFS:**
  - Where: `https://publico.cp.pt/gtfs/gtfs.zip` (national access point dataset 176).
  - What: every CP service, 3,255 trips and 458 stops, Lisbon and Porto suburban included.
  - Dates: 14 Dec 2025 to 11 Dec 2027, so the timetable from 13 Dec 2026 is already in.
  - Updates: up to weekly (last modified 21 Nov 2026); 540 KB. No registration.
  - **Licence:** the access point says "No licence – No contract", so commercial reuse isn't granted.
    CP's legal notice also forbids reproducing its content without written authorisation.
  - **Gaps:**
    - the Celta isn't in it (check whether Renfe's data, which our Spain build already reads, has it);
    - the Badajoz trains (481/485, 482/486) stop at Elvas in the file.
- **Fertagus GTFS:**
  - Where: `https://www.fertagus.pt/GTFSTMLzip/Fertagus_GTFS.zip` (dataset 185).
  - What: shapes and fares, valid 14 Sep 2026 to 14 Mar 2027, updated up to yearly.
  - **Licence:** CC BY 4.0, commercial use allowed. No registration.

## Rail network and classification

- **Track:** OpenStreetMap, from Geofabrik's `europe/portugal`.
- **IP's open data on dados.gov.pt** (CC BY, updated quarterly):
  - the national network (59 segments: line name and status only);
  - 571 stations (no codes).

  Useful for line names.
- **Speed, electrification and track:**
  - IP's network statement annexes, in PDF only;
  - ERA's register of infrastructure (RINF), matched onto the OSM track;
  - OSM's own tags.
- **Gauge and power:**
  - Iberian gauge, 1,668 mm, like Spain's conventional network;
  - the Vouga line is metre gauge (1,000 mm);
  - 25 kV 50 Hz.
- **High-speed lines:** none in service yet. The Alfa Pendular runs on upgraded lines.

## Live data

**None official.** Things we checked and won't use:
- CP's website and app, and IP's departures page, run on internal addresses (unofficial). CP's
  legal notice forbids reusing them.
- The GTFS has no platforms, and IP's live board has none either.

**Until there's an agreement:**
- positions come from the timetable ("según horario");
- a banner says there's no live data for Portugal ([plan-incidents.md](../plan-incidents.md)).

## Warnings, planned works, lifts

- **Notices:** `https://cp.pt/avisos` (a web page). Strikes ("greves") come as minimum-service
  PDFs. Neither is machine-readable, so the app links to CP's notices page.
- **Planned works:** IP's network statement annex 4.3.2 A (PDF), and CP's notices. The press reports
  a road transfer between Valença and Vigo for Celta trains 420–423 from April 2026 to April 2027
  (unverified).
- **Lifts:** none open.

## Storage

- **R2 `/pt/`:**
  - one national file (all CP trains, fewer than Spain's long-distance file);
  - Fertagus;
  - track by region.
- **Plan-ahead:** the GTFS runs to Dec 2027, so the full 9 weeks are covered.

## Server

- **Nothing to poll:** no live sources.
- **The incidents check** ([plan-incidents.md](../plan-incidents.md)) shows Portugal as timetable
  only, so the app never suggests the data is live.

## Registrations, passwords and secrets

- **Accounts:** none.
- **Letters**, from Metranos Ltd, by email:
  - **CP** (`institucional@cp.pt`, the access point's contact): permission to reuse the GTFS
    commercially, and access to live data;
  - **IP**: access to real-time train running (delays, cancellations, platforms).
- **Secrets:** none.

## Operators and tickets

| Operator | Tickets |
|---|---|
| CP | cp.pt |
| Fertagus | no online sales seen (Navegante cards and station tickets); link to fertagus.pt |
| Celta (CP + Renfe) | cp.pt, renfe.com |

## Language, time, stations, borders

- **Language:** European Portuguese (`pt-PT`) app strings and store listing.
- **Time zone:** Europe/Lisbon, an hour behind Madrid. The Celta and the Badajoz trains change zone
  at the border.
- **Station ids:**
  - CP uses `94_` plus a five-digit code (`94_2006` is Porto-Campanhã). Ours become `pt:94_2006`.
  - Badajoz is `71_37606` in CP's data. That's Adif's code (37606), so it links straight to our
    Spanish Badajoz.
  - Fertagus has its own ids (`FTStopN`), matched by name and position.
- **Cross-border:** Porto–Vigo (Celta) and Entroncamento–Badajoz, merged with Renfe's data
  ([plan-europe.md](../plan-europe.md), A8).

## Credits

- Fertagus, CC BY 4.0.
- CP, in whatever words its permission asks for.
- IP, CC BY.
- OpenStreetMap, ODbL.

## Risks

- CP may say no, or take a long time.
- No live data for the foreseeable future.
- Strikes are frequent, and only announced in PDFs.
- The Celta's road transfer.

## Steps

- **P0, now, no code:** the letters to CP and IP.
- **P1, once CP agrees:**
  - reference data (CP, Fertagus, the links with Spain);
  - app strings in Portuguese, credits and operators;
  - release as beta, timetable only.
- **P2, if CP or IP give live data:** an adapter in `backend-eu/`.
