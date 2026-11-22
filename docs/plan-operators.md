# Plan: operators and where to buy tickets

Status: **proposed 2026-11-22**, nothing built yet.

The maintainer's request: show which company operates each train, with a link to that company's
website where it sells tickets.

## What we have

- **Spain:** one operator per timetable file (`TimetableFile.operator`: "Renfe" or "OUIGO"), and
  Renfe's product per route (AVE, Avlo, Alvia, MD, Cercanías…). Iryo isn't in the data: it has
  no open timetable we know of. If it publishes one on the NAP, it's added the way OUIGO was
  (`NAP_API_KEY`).
- **Great Britain:** the operator of each train comes from its ATOC code (the route is the
  operator, `operator_name()` in `crates/refdata-build/src/nrsched.rs`).
- **Northern Ireland:** Translink.
- No ticket links, apart from the official links on OUIGO's and Renfe's trains.

## Data

- One list of operators per country, in the country registry
  ([plan-europe.md](plan-europe.md), A1). Each entry has:
  - `id`;
  - `name`;
  - the website;
  - the ticket page, per language where the site has one.
- **Which operator runs a train:**
  - Spain: by timetable file;
  - Great Britain: by ATOC code;
  - countries with GTFS: by the route's `agency_id`.
- The operators go in the manifest's JSON, with the mapping of each region or route to an
  operator. The binary format doesn't change, and installed apps ignore the new field.
- **Great Britain:** any operator's website sells tickets for any train, at the same fares. Linking
  to the train's own operator is therefore fair. National Rail's journey planner is the neutral
  alternative, for a journey that changes operator.
- Each new country brings its operators. The per-country plans in [europe/](europe/README.md) list
  them.

## App

- **Train sheet:** "Operado por **LNER** · Comprar billetes ↗" under the train's name.
- **Journeys:**
  - each leg shows its operator;
  - each operator gets one "Comprar" link (a journey with two operators has two);
  - in Great Britain, one link to the first leg's operator, which sells the through ticket.
- **Station departures:** the operator's short name on each row, at stations with more than one
  operator (Great Britain, France, Germany…).
- **How links open:** in the browser (the system browser in the Android app), like today's official
  links. They are plain links, so the Content-Security-Policy doesn't change.
- **Names only, no logos:** using someone's logo needs their permission. About keeps the "not
  affiliated with…" line for every operator.
- Free for everyone.

## Later

- **Deep links** with origin, destination and date, for operators whose sites have a stable,
  documented address for them. Check each one; never guess an address.
- **Affiliate programmes** (e.g. Trainline, Omio) pay for each sale.
  - In exchange, they need an "affiliate link" notice next to the link.
  - They also make the app less neutral.
  - This is the maintainer's decision; it isn't planned.

## Steps

- **O1 (Spain, Great Britain, Northern Ireland):**
  - operator lists and the manifest field;
  - the train sheet, journeys and departures;
  - ES and EN strings;
  - tests: every route has an operator; every operator has a ticket link in ES and EN, or a
    fallback.
- **With each new country:** its operators, in the same PR as its data.
