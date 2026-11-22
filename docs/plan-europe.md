# Plan: Europe, country by country

Status: **proposed 2026-11-22**, nothing built yet. The maintainer's decisions are needed on the
points in [section 8](#8-decisions-for-the-maintainer).

The maintainer's request:
- Add the rest of Europe one country at a time, starting with **Portugal, Ireland and France**.
- First change the architecture, so that adding a country is mostly configuration and data, not
  new code.
- For each country, plan:
  - storage and the server;
  - the timetable APIs;
  - the rail network and how its lines are classified;
  - GPS;
  - warnings and planned works;
  - registrations, passwords and other secrets.

  That is in [europe/](europe/README.md).

Plans for the other requests in the same message:

| Plan | What |
|---|---|
| [plan-operators.md](plan-operators.md) | Each train's operator, with a link to the site where it sells tickets |
| [plan-cab-rides.md](plan-cab-rides.md) | YouTube cab-ride videos, opened at the moment each station appears |
| [plan-crowd-reports.md](plan-crowd-reports.md) | Travellers report delays, cancellations and accidents, checked against their location |
| [plan-incidents.md](plan-incidents.md) | Problems captured from the apps, from users and from our servers; feed failures shown as they happen |
| [plan-lifetime.md](plan-lifetime.md) | TrainRadar Pro for life, €9.99 |

## 1. What already works for any country

- **Timetables:** `refdata-build` turns GTFS (Renfe, OUIGO, Translink) and CIF (Network Rail) into
  the app's files.
- **Live data:** the engine reads GTFS-Realtime trip updates.
  - For the UK, `backend-uk` turns Network Rail's TRUST messages into GTFS-Realtime, so the engine
    didn't change.
  - Any other live source can be converted the same way, on the server.
- **No GPS needed:** without positions, trains are placed by timetable plus the live delay (the UK,
  OUIGO).
- **Track and its kind:** OpenStreetMap track per region, with gauge, maximum speed,
  electrification and number of tracks (`LegInfo`, `SectionInfo`). It comes from Geofabrik
  extracts, which exist for every European country.
- **The features built on top work on any timetable:** journeys with changes, the plan-ahead
  planner, notices, alerts, widgets and the delay history.
- **A country switch** (Spain, United Kingdom), with settings kept per country (`favourites-uk`,
  `commute-uk`).

## 2. What doesn't scale yet

| Today | Why it blocks 30 countries |
|---|---|
| Countries are hard-coded in 15 places: `COUNTRIES = ["es", "uk"]`, `applyCountry()` special-cases the UK, the `UK_APP` build flag, storage keys per country by hand, `NATIVE_BASES` only for Spain | Every country would touch app code in a dozen places |
| One Worker per country (`backend/`, `backend-uk/`) and its own workflows (`refdata-uk.yml`, `uk-feed-check.yml`, `ni-feed-check.yml`) | 30 Workers and ~90 workflows to maintain |
| Madrid time everywhere (`service_day_base`, `madrid_offset`), with `behind_madrid_secs = 3600` for the UK and NI | Finland, the Baltic states, Romania, Bulgaria and Greece are an hour *ahead* of Madrid; cross-border trains change zone |
| Station ids are each source's own codes | Two countries can use the same code; a border station appears in two countries' feeds |
| All reference data is in the Pages deploy (`data/`, `data/uk/`) | One deploy for every country: a failed build blocks the rest, each change redeploys everything, and Pages limits files to 25 MiB and 20,000 per deploy |
| Spanish and English strings share one 1,087-line `i18n.js` | Portuguese, French, German, Italian… can't all load for everyone |
| Notices: Renfe alerts and National Rail incidents, each with its own code | Every country publishes disruptions, works and lifts differently |

## 3. Architecture changes

### A1. One registry of countries

One file per country, `countries/<cc>.toml`, is the only place a country is described:

```toml
code = "pt"
name = { pt = "Portugal", es = "Portugal", en = "Portugal" }
languages = ["pt"]
time_zone = "Europe/Lisbon"
uic = 94
view = { center = [-8.2, 39.6], zoom = 6.3 }
status = "beta"            # hidden, beta or live
osm = "europe/portugal"    # Geofabrik extract

[[timetable]]              # one per source
id = "cp"
format = "gtfs"            # gtfs, netex or cif
url = "…"
licence = "…"
credit = "…"
secret = ""                # the GitHub secret's name, if the download needs one

[[live]]                   # one per live source
id = "…"
adapter = "gtfsrt"         # gtfsrt, siri, or a country's own API
every = 30                 # seconds
secret = ""

[[notices]]                # disruptions, works, lifts
…

[[operator]]
id = "cp"
name = "CP – Comboios de Portugal"
tickets = { pt = "https://…", en = "https://…" }
```

What the registry feeds:
- **Refdata workflow:** builds every country as a matrix, one job each, so one failure doesn't stop
  the others.
- **Ingest Worker (A5):** knows which feeds to poll.
- **The app:** gets `countries.json` (names, view, status, size, where the data is).
- **About screen:** each country's sources and credits.
- **Tests:** every country has its strings, credits, checks and operators (A12).

Spain and the UK move into the registry too, without changing their files or addresses.

### A2. Local time per region

Every country in scope uses the EU's summer-time dates, so each zone stays a fixed distance from
Madrid all year:
- **One hour behind:** Lisbon, Dublin and London.
- **The same:** most of Europe.
- **One hour ahead:** Helsinki, Tallinn, Riga, Vilnius, Bucharest, Sofia and Athens.

Moldova is the exception: it changes its clocks an hour earlier than the EU, so it would need its
own rule if it's ever added.

The changes:
- **Each region gets `tz`** (an IANA name) in the manifest.
- **The engine** maps the zone to its distance from Madrid, replacing `behind_madrid_secs()`. No
  time-zone database is needed in the app.
- **Display:** each stop shows in its own local time, as printed timetables do, with a note when a
  train crosses into another zone.
- **No data-format change:** `tz` lives in the JSON manifest, which installed apps ignore.
- If the EU ever drops summer time, this table is the one place to change.

### A3. Station ids across borders

- **Prefixed ids:** the new countries' stations get ids prefixed with the country, such as
  `fr:87686006`. Spain's and the UK's keep theirs, so favourites and saved journeys keep working.
- **UIC codes:** where feeds give UIC codes (France, Switzerland, Germany, Portugal…), the build
  keeps them.
- **`links.json`:** per border, it lists the same physical station in two countries' data, matched
  by UIC code or by hand (for example Dublin Connolly in Translink's and Irish Rail's data, or
  Hendaye in SNCF's and Renfe's).
- **Journeys** treat linked stations as one, and walk between nearby ones, as now.
- **Trains in two feeds** are merged by train number and date (Renfe's and SNCF's Barcelona–Paris;
  Translink's and Irish Rail's Enterprise). The operator's own feed wins.

### A4. Reference data: R2 instead of Pages, built per country

**Where it goes:**
- The new countries' reference data goes to a new R2 bucket with a CDN domain (e.g.
  `data.mytrainradar.com`), one folder per country.
- Each folder has `/<cc>/manifest.json` (5-minute cache) and content-hashed files (1 year,
  immutable), as today.
- Spain and the UK stay on Pages until installed apps no longer need the old addresses, then move.

**When it's uploaded:**
- Each country's job uploads only its own files, when its timetable changes.
- A cleanup job removes files that no manifest has listed for 30 days.

**How big countries are split:**
- Big countries are split into regions, as Spain's Cercanías are by núcleo: one national file for
  long-distance trains, loaded at once, and regional files loaded when the map zooms in or a
  station or journey needs them.
  - France: TGV, OUIGO and Intercités, plus one file per TER region, plus Transilien.
  - Germany: long distance, plus one file per Land.
  - Italy: long distance, plus one file per region.
- Plan-ahead files (9 weeks) are split by week, so a date far ahead downloads one week (the split
  already offered for the UK).

**Input formats:**
- **GTFS** covers most countries, and `refdata-build` reads it already.
- **NeTEx** is the format every EU national access point must offer, and a few countries publish
  their full timetable only in it. A NeTEx reader (the European passenger information profile) in
  `refdata-build` opens those countries ([europe/README.md](europe/README.md) says which). Wave 1
  doesn't need it.

### A5. Live data: one ingest Worker, one Durable Object per feed

**The shape:**
- New countries share one Worker, `backend-eu/`, with **one Durable Object per feed**.
- Each object has its own timer, back-off and status, so a failing or slow feed never touches
  another.
- A feed can be switched off from the registry without a redeploy.

**Adapters, by kind of source rather than by country:**
- `gtfsrt`: fetch and check the feed, keep rail only, rename the trip ids to ours, write.
- `siri`: SIRI ET/VM/SX turned into GTFS-Realtime and notices.
- One-off adapters where a country has its own API (Irish Rail, Digitraffic in Finland,
  Trafikverket in Sweden…).

**Output per country,** in the live bucket next to Spain's and the UK's, written only when
something changed:
- `<cc>/rt/trip_updates.pb`;
- `<cc>/rt/vehicle_positions.pb`, where there is GPS;
- `<cc>/rt/notices.json` (A6);
- `<cc>/rt/status.json`.

**Spain and the UK:**
- `backend/` and `backend-uk/` stay as they are: they work, and keeping them apart was a decision.
- What they share (status, back-off, GTFS-Realtime encoding, R2 writes) moves first into a small
  module that `backend-eu/` uses too.

**Limits to check for each source:**
- Workers can't hold a connection open for long. Push feeds are drained once a minute, like the UK's
  STOMP; ZeroMQ isn't possible.
- Workers have no fixed outgoing IP address. A source that only admits listed addresses needs
  another route.

**History:** delay history for other countries comes later. The recorder needs CPU per country, so
measure it first.

### A6. Notices: one format for disruptions, works and lifts

- **What goes in:** disruptions, strikes, planned works, replacement buses, and lift and escalator
  faults, all in `notices.json` per country.
- **One shape:**
  `{ id, kind, severity, title, text, url, stations, lines, trains, from, until, updated, source, lang }`.
- **Spain and the UK too:** Renfe's alerts and the UK's incidents are converted to it, so the app
  has one code path.
- **Language:** the text stays in the source's language, as plain text (shown with `textContent`).
  Automatic translation is decision 3.
- **Alerts:** saved journeys' station alerts (J4) use it in every country.

### A7. The app

- **Choose countries.**
  - The first run asks "¿Qué países quieres?", with the phone's country ticked and each country's
    download size.
  - This is the request to download train data. It also carries two separate switches:
    - sharing travellers' reports, unticked ([plan-crowd-reports.md](plan-crowd-reports.md));
    - anonymous error reports ([plan-incidents.md](plan-incidents.md)).
  - Settings → Países adds or removes countries later.
- **One country on the map at a time,** as now, with a quicker switcher. Near a border, the
  neighbour's long-distance trains show too (A8).
- **Settings per country** from one helper (`keyFor("favourites", cc)`), with Spain's keys
  unchanged.
- **Widgets and background alerts** read every country. Today `NATIVE_BASES` and `AlertsWorker`
  read only Spain.
- **Languages:**
  - one file per language, loaded on demand, with English for any missing string;
  - Portuguese and French with wave 1, then German, Italian, Dutch… with their countries;
  - a store listing per language;
  - station names stay as published.
- **Times** show in each station's own zone (A2).
- **About:** the credits of each country, and "not affiliated with…" for each operator.

### A8. Cross-border trains and journeys

- A country's manifest lists its neighbours' long-distance regions. Near a border, or for a
  cross-border train, the app loads them too.
- A journey across a border loads the long-distance regions of both countries, plus the local ones
  at each end (today's rule for Cercanías).
- Examples:
  - Porto–Vigo (Celta) and Badajoz–Entroncamento;
  - Dublin–Belfast (Enterprise);
  - Barcelona–Lyon/Marseille/Paris, and Irun–Hendaye;
  - Paris/Brussels–London (Eurostar).

### A9. Licences and terms

- **Which sources:** only official sources whose licence allows commercial reuse and
  redistribution, or that come with a signed agreement.
- **No unofficial or reverse-engineered addresses** without written permission. The decision not to
  scrape Adif applies everywhere.
- **Credits:** each source's licence, credit and "processed by TrainRadar" wording are in the
  registry and shown in About. The build fails for a source that has none.
- **ODbL data:** OpenStreetMap track, and any other source under the ODbL, is a derived database we
  serve publicly. It stays available under the ODbL, with the credit, as today.

### A10. Registrations, passwords and secrets

- **Accounts:**
  - opened by **Metranos Ltd**, with a shared mailbox (e.g. `data@` the domain), never a personal
    address;
  - passwords and two-factor codes kept in the maintainer's password manager;
  - a private register, not in the repository, of each account, its terms, renewal dates and
    contact.
- **Approving secrets:** the maintainer approves each secret per source before it's added, and it
  goes into AGENTS.md (as `NETWORK_RAIL_*` did).
  - Names follow `<CC>_<SOURCE>_<KIND>`, e.g. `IE_NTA_API_KEY`.
  - AGENTS.md's list today misses `NAP_API_KEY` (OUIGO's timetable, approved 2026-11-02), which
    the workflows already use.
- **Where secrets live:**
  - GitHub Actions secrets, used only by workflows that run on `main`;
  - passed to Worker secrets through stdin;
  - never printed, never in an address, an artifact or a file the site serves.
- **Feed checks:** each country gets one, like `ni-feed-check.yml`. It proves the downloads and the
  login work before anything is built on them.
- [europe/README.md](europe/README.md) lists every account and secret by country.

### A11. Costs (estimate; measured per country)

| Item | All of Europe |
|---|---|
| R2 storage for reference data | 2–5 GB: cents a month |
| Live feeds: ~40 Durable Objects polling every 15–60 s | ~3–5 million requests a month: a dollar or two above what Workers Paid includes |
| R2 writes, only when a feed changed | 1–3 million a month: up to about $10 |
| CPU (decode, rename, encode) | a few dollars |
| User reads | from the CDN: free |
| GitHub Actions | free: the repository is public |

The Workers Paid plan ($5 a month) already covers most of it. Each country's live job is measured
in its PR, as Spain's was ([costs.md](costs.md)).

### A12. When a country is done

- **Data:**
  - the feed check passes;
  - `verify` passes on the reference data: trips on track, stations placed, no gaps;
  - the journeys bench runs a few known trips;
  - memory and load time stay within budget on a mid-range phone.
- **Live:**
  - status green for 48 hours;
  - at least 95 % of live updates match a trip in the timetable.
- **App:**
  - strings in the country's language;
  - credits;
  - operators with ticket links;
  - an emulator smoke test.
- **Release:** it starts as **beta** (visible, with a badge) for testers, then goes **live**.

## 4. Order

See [europe/README.md](europe/README.md): wave 1 as asked (Portugal, Ireland, France), then the
countries with the best open data and the closest links.

## 5. How a country is added: one PR per step

1. **Feed check and registrations:** accounts opened, secrets approved, downloads proven.
2. **Reference data:** timetables, stations, track and its kind, regions; `verify` and the bench.
3. **Live:** the adapters in `backend-eu/`, notices, status.
4. **App:** the registry entry, language, credits, operators; release as beta.
5. **Store listing** in the country's language; then live.

## 6. Architecture work before the first country (phase E0)

| Step | Scope |
|---|---|
| E0a | Country registry and `countries.json`; one generic `applyCountry()`; settings keys per country; Spain and the UK moved in with no visible change |
| E0b | `tz` per region in the engine; each stop shown in its own zone |
| E0c | R2 data bucket and CDN domain; matrix build per country; weekly plan-ahead files |
| E0d | `backend-eu/` skeleton: shared module, `gtfsrt` adapter, status; one notices format, with Spain's and the UK's converted |
| E0e | App: choose countries at first run, Settings → Países, strings split per language |
| E0f | Cross-border: station links, merged trains, neighbours' long-distance regions |

E0a–E0e come before Portugal; E0f with France, which has the most cross-border trains.

## 7. Risks

- **No official live data in a country:** timetable positions only, labelled as such, as for
  OUIGO. Portugal looks like this ([europe/pt.md](europe/pt.md)).
- **Terms that forbid commercial use, or limit requests per day:** the registry records them, and
  the feed check alerts when we're near a quota.
- **Phones:** the biggest networks (Germany, France) are larger than the UK in memory. The regional
  split (A4) is what keeps them light; it's measured in each country's PR.
- **Upkeep:** with 30 countries, some feed changes something most weeks. The feed checks and
  [plan-incidents.md](plan-incidents.md) are what make that visible quickly.

## 8. Decisions for the maintainer

1. **Order within wave 1.** Ireland and France have official live data; Portugal, so far, only a
   timetable. Keep Portugal first anyway (timetable positions at first), or start with Ireland?
2. **Data domain.** A new `data.` subdomain for the R2 data bucket (A4), or a folder on the existing
   live domain?
3. **Notices in other languages.** Show them as published, or add automatic translation on the
   server (marked "traducido automáticamente")?
4. **Accounts.** A shared mailbox for registrations, and who holds the passwords (A10).
5. **Secrets.** Approve, per wave, the secrets listed in [europe/README.md](europe/README.md).
