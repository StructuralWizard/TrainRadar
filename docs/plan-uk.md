# Plan 3: the United Kingdom (TrainRadar 3.0)

Status: **architecture agreed with the maintainer on 2026-11-12** (decisions below).
Phase 3a verifies the feeds; the plan's details may change with what it finds, and any
change to a decision goes back to the maintainer.

The app shows **one country at a time**: España or Reino Unido, chosen on the network
chip. Each country has its own reference data, live feeds, history and replay; nothing is
mixed. Everything in [AGENTS.md](../AGENTS.md) still applies.

## Decisions (2026-11-12)

1. **A separate UK ingest Worker** (`backend-uk/`) on the same Cloudflare account, with its
   own deploy, writing to the same live R2 bucket under `uk/` and served from the same
   `live.` domain. A UK problem or redeploy never touches Spain's poller or recorder.
2. **One API Worker with a country prefix**: `/v1/history/…` stays Spain's;
   `/v1/uk/history/…` is the UK's.
3. **3.0 without TD.** UK positions are estimated (timetable + live delay + last TRUST
   report) and labelled so. TD (signalling berths) for finer positions is 3.1, with Darwin.
4. **Pro is the same in the UK**: same subscription, same features, same price.
5. **Secrets**: `NETWORK_RAIL_USERNAME`, `NETWORK_RAIL_PASSWORD` (Network Rail open data
   login) and, later, `NATIONAL_RAIL_KB_KEY` (Rail Data Marketplace, incidents), as GitHub
   Actions secrets used only on `main`, and as Cloudflare Worker secrets. See AGENTS.md.

## Sources

| Source | What | How | Licence |
|---|---|---|---|
| Network Rail TRUST (`TRAIN_MVT_ALL_TOC`) | Activations, movements with minutes late/early at timing points, cancellations | STOMP push, login | OGL v3 |
| Network Rail VSTP (`VSTP_ALL`) | Short-notice extra or changed trains | STOMP push, login | OGL v3 |
| Network Rail SCHEDULE | The timetable (full weekly + daily updates), JSON lines | HTTPS download, login | OGL v3 |
| Network Rail CORPUS, SMART | Location codes (TIPLOC, STANOX, CRS, names); berth ↔ STANOX | HTTPS download, login | OGL v3 |
| NaPTAN (DfT) | Station coordinates by TIPLOC / CRS | Public download | OGL v3 |
| OpenStreetMap, Great Britain | Track, for routing trains between stops | Geofabrik extract, as Spain | ODbL |
| National Rail Knowledgebase incidents | Passenger notices (the UK "Avisos") | Rail Data Marketplace, HTTPS + key | RDG terms (to check) |
| Network Rail TD (`TD_ALL_SIG_AREA`) | Signalling berth steps | STOMP push | OGL v3 — **3.1** |
| Darwin (National Rail) | Forecasts, platforms, delay reasons | Rail Data Marketplace, Kafka | **3.1** |

Attribution: "Contains information of Network Rail Infrastructure Limited licensed under the
Open Government Licence v3.0", plus NaPTAN's and OpenStreetMap's.

## Architecture

```
Network Rail STOMP ──► UK ingest Worker (backend-uk/, Durable Object, alarm every minute)
 TRUST + VSTP           │ connects with a durable subscription, drains what's queued, disconnects
                        │ keeps: TRUST train id → schedule (UID, date), last report, delay
                        ├─► R2 uk/rt/trip_updates.pb   (GTFS-Realtime TripUpdates, like Renfe's)
                        ├─► R2 uk/rt/status.json, uk/rt/summary.json (widget, alerts)
                        └─► UK recorder (Spain's code) ─► D1 (country column), uk/replay/…
NR KB incidents ──────► same Worker, every 5 min ─► uk/rt/alerts.pb (GTFS-Realtime Alerts)

SCHEDULE + CORPUS + NaPTAN + OSM GB ──► refdata build (GitHub Actions, daily, secrets on main)
                                        └─► web/data/uk/: manifest, stations, timetables by area, track

App ── chip España | Reino Unido ──► engine reloaded with ONE country's data and feeds
API Worker (existing) ──► /v1/history/… (Spain), /v1/uk/history/… (UK)
```

- **Why a minute drain, not a socket held open:** a durable subscription makes the broker
  queue messages while we're away, so restarts and redeploys lose nothing, and a short
  connection a minute costs far less Durable Object time than one open all day. Delays are
  at most a minute old; TRUST only reports at timing points anyway. Fallback, only if the
  drain can't keep up: a small always-on server elsewhere.
- **Why GTFS-Realtime on our side:** the app's engine already reads it, so the UK needs a
  Network Rail adapter for matching and the server-side conversion, not a second pipeline.
- **Positions:** no GPS in UK open data. A train is drawn where the timetable puts it,
  shifted by its live delay and held at its last reported location until it's due to have
  left; shown as estimated, like OUIGO.

## The Android app

The same app and Play listing: a country switch, not a new app.

- The web bundle (Capacitor) loads one country at a time. Spain's map data stays bundled;
  the UK's is downloaded on first switch and cached. Timetables are loaded by area, as with
  Cercanías.
- Favourites, commutes and trips are saved with their country (existing ones migrate as
  Spain); switching shows that country's.
- Widget and background alerts read each favourite train's own country
  (`rt/summary.json` or `uk/rt/summary.json`), so Spanish and British trains can both alert.
- One Pro subscription for both countries. Play Console: add the United Kingdom to the
  countries; the en-GB listing exists.
- Default country: España, or Reino Unido when the phone's region is the UK. UI language
  stays a separate choice (ES/EN).

## Phases (one branch and PR each)

| | What | Needs |
|---|---|---|
| **3a** | This plan, AGENTS.md secrets rule, the UK feed check (`.github/workflows/uk-feed-check.yml`, `tools/uk-feed-check/`): login, live rates and message types, SCHEDULE/CORPUS/SMART sizes and real samples → `docs/data-sources-uk.md` | the secrets |
| 3b | UK reference data: SCHEDULE → timetables by area, stations (CORPUS + NaPTAN), OSM GB track → `web/data/uk/` | 3a |
| 3c | `backend-uk/`: STOMP drain, TRUST → GTFS-RT TripUpdates, status and summary; deploy job | 3a |
| 3d | App: country switch, per-country config and storage, Network Rail adapter, estimated positions, UK attribution | 3b, 3c |
| 3e | UK recorder, history API prefix, replay; KB incidents → Avisos (once the key exists) | 3c |
| 3f | Release 3.0 (Play notes, store texts, screenshots for the UK) | all |

## To find out in 3a

- Login works for STOMP and the HTTPS files; which topics deliver to this account.
- Message rates and sizes (TRUST, VSTP, TD): whether a one-minute drain fits.
- That durable subscriptions (`client-id` + `activemq.subscriptionName`) are allowed.
- SCHEDULE full and update sizes; CORPUS/SMART fields; how many CORPUS locations have
  NaPTAN coordinates.
- Any terms in the account (rate limits, attribution, redistribution) to respect.
