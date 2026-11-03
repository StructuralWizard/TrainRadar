# Plan C: central backend, web changes, Android Free + Pro

Status: **approved by the maintainer** as the scope for phases C1–C7. Written 2026-11-03.
This plan changes two design rules from earlier phases, on the maintainer's decision:

1. Renfe's feeds are fetched **once, centrally, on a schedule**, not once per open tab.
2. A new backend component (the **recorder**) decodes feeds to build delay history.
   The CORS/feed path itself still forwards Renfe's bytes unchanged.

Everything in [AGENTS.md](../AGENTS.md) still applies: no secrets in the repo, `textContent`
for feed text, CSP kept, location never leaves the device, one branch and PR per phase,
conventional commits, fmt/clippy/tests green. Any **new** secret (Android upload key, Play
service account) needs the maintainer's explicit approval in-session and lives only in
GitHub Actions secrets or Cloudflare Worker secrets.

---

## 0. Target architecture

```
                 every ~20 s (one fetch per feed, ETag/If-Modified-Since)
Renfe GTFS-RT ─────────────► Poller (Durable Object alarm, fallback: cron loop)
                               │  writes raw .pb bytes unchanged
                               ├──► R2 bucket "trainradar-live"  /rt/<feed>.pb
                               ├──► R2 /rt/status.json  (Renfe Last-Modified, fetched-at, ok/error per feed)
                               └──► Recorder (same DO or a second one)
                                      │  decodes with the Rust engine (workers-rs / wasm)
                                      ├──► R2 /rt/summary.json   (train → delay, next stop, status; for widget + alerts)
                                      └──► D1 "trainradar-history"  (one row per finished trip + daily aggregates)

Clients (web, Android) ──► https://live.<domain>/rt/*.pb, status.json, summary.json
                           served by Cloudflare CDN from R2 (custom domain, Cache-Control max-age=10)
                       ──► https://api.<domain>/v1/history/...  (Worker, read-only, edge-cached 1 h)
```

Why: today every tab calls the proxy Worker (~510 requests/hour/tab, free tier ≈ 195 viewing
hours/day). With R2 behind a custom domain, cached responses don't invoke a Worker or count
as R2 operations, so client count stops driving cost, and Renfe sees one client instead of
thousands. The engine keeps running on the client exactly as now; only `rtBase` changes.

**Keep the current proxy Worker** deployed as a fallback (`CONFIG.rtFallback`) until C1 has
run cleanly for 14 days, then decide with the maintainer.

---

## C1 — Central poller + live bucket (branch `phase/c1-poller`)

- New `backend/` folder (Cloudflare Workers, TypeScript or JS, tested with
  `node --test`/`vitest` + Miniflare). Keep `worker/` untouched.
- **Poller**: a Durable Object whose alarm fires every 20 s (±2 s jitter). For each of the
  five feed paths already allow-listed in `worker/src/index.js`: conditional GET to
  `gtfsrt.renfe.com` (send `If-None-Match`/`If-Modified-Since`); on 200 write the bytes to
  R2 `rt/<name>.pb` with `Cache-Control: public, max-age=10`; on 304 do nothing.
  Exponential backoff per feed on errors (max 10 min). Alerts feed every 2 min.
  A cron trigger every minute only (re)arms the alarm if it died.
- Write `rt/status.json` every cycle: `{feed: {renfeLastModified, fetchedAt, ok, error?}}`.
  This replaces reading `Last-Modified` from the proxy response.
- R2 bucket CORS: `GET` from the site origins only (same list as `ALLOWED_ORIGINS`), plus
  `capacitor://localhost` / `https://localhost` for the Android app.
- Custom domain on the bucket (maintainer buys/attaches the domain; Claude Code documents
  the steps in `docs/deploy.md`). Never use the rate-limited `r2.dev` URL in production.
- Deploy job added to `deploy.yml` (main only, same secrets, minimal permissions).
- **Tests**: poller with mocked Renfe (200, 304, 5xx backoff, timeout), status.json shape,
  object headers. **Acceptance**: 24 h on staging with ≥ 99% cycles OK; a client fetching
  `rt/vehicle_positions.pb` gets bytes identical to Renfe's.

## C2 — Web app amendments (branch `phase/c2-web`)

- `web/js/config.js`: `rtBase` → live host; `rtFallback` → current proxy; `feeds.js` switches
  to the fallback after 3 consecutive failures and back after 10 min. Feed age from
  `status.json` instead of the `Last-Modified` header. Update CSP `connect-src`.
- Lower client poll interval floor to 20 s now that it hits the CDN (keep jitter, keep pause
  when hidden).
- **App promotion** (no cookies, no tracking): "Get the Android app" button in About;
  in the train popup a small "Delay alerts for this train → Android app" link; a one-time
  dismissible banner from the 3rd visit (visit counter in `localStorage`, wrapped in
  try/catch). Play badge only after the listing is live (`CONFIG.playUrl` empty → hidden).
- **Support**: "Invita a un café / Buy me a coffee" link in About (web only, never inside
  the Android build: see C5).
- **History teaser** (after C3): "Puntualidad de tu línea, últimos 7 días" panel reading the
  public history API, with "full history in TrainRadar Pro" note.
- **Legal pages** (ES + EN, static HTML in `web/legal/`): Privacidad / Privacy, Términos /
  Terms, Aviso legal / Provider identification, Licencias y atribución / Data licences.
  Drafts per section 6; the maintainer fills name, address, email before publishing.
- Web stays **ad-free, cookie-free, analytics-free**. All existing features stay free on web.
- **Tests**: unit tests for fallback switching and visit counter; browser test that the
  banner shows once and can be dismissed; CSP check.

## C3 — History recorder + public API (branch `phase/c3-history`)

- Build `crates/engine` for the Worker (workers-rs or wasm-bindgen `--target web` loaded in
  the DO). The recorder ingests the same bytes the poller just stored, plus the reference
  `.bin` files (AV/LD/MD always; Cercanías núcleos loaded lazily, all of them for recording).
  **Risk check first**: measure memory with all núcleos loaded. If above ~100 MB or CPU per
  cycle above the Worker limit, stop and report options to the maintainer (record AV/LD/MD
  + top 5 núcleos only, or a small VPS running the native engine — ~€4/month).
- **summary.json** every cycle (gzip): `[{trainNo, line, product, delayMin, nextStopId,
  status: running|stopped|cancelled, updatedAt}]`. Used by the Android widget and alerts.
- **D1 schema** (migrations in `backend/migrations/`):
  ```sql
  -- one row per finished (or 3 h stale) run; stop delays packed to stay under write limits
  CREATE TABLE trips (
    service_date TEXT, trip_id TEXT, train_no TEXT, line TEXT, product TEXT,
    origin_id TEXT, dest_id TEXT, sched_dep INTEGER, sched_arr INTEGER,
    arr_delay_min INTEGER, max_delay_min INTEGER, cancelled INTEGER,
    stops_json TEXT,          -- [[stop_id, sched_ts, delay_min, estimated(0/1)], ...]
    source_quality TEXT,      -- 'renfe_tu' | 'gps_estimate'
    PRIMARY KEY (service_date, trip_id));
  CREATE TABLE line_daily (
    service_date TEXT, line TEXT, product TEXT, trips INTEGER, on_time INTEGER,
    late_5 INTEGER, late_15 INTEGER, cancelled INTEGER, median_delay REAL, p90_delay REAL,
    PRIMARY KEY (service_date, line, product));
  ```
  Aggregate `line_daily` once a day (cron 03:30 Madrid). Writes stay ~10–15k rows/day.
- **API** (`api.<domain>`, read-only, `Cache-Control: public, max-age=3600`, CORS as C1):
  `GET /v1/history/line/:line?days=7..365`, `GET /v1/history/train/:trainNo?days=…`,
  `GET /v1/history/station/:stopId?days=…`. No personal data exists in this database.
- Data rules: record only what Renfe publishes; mark estimated delays; skip trains whose
  feed is older than 10 min; alerts feed stale >24 h → don't store alerts.
- Retention: `trips` 24 months (monthly cron deletes older), `line_daily` forever. Weekly
  export of D1 to R2 `backups/` (gz NDJSON), R2 lifecycle deletes backups after 90 days.
- **Tests**: recorder on fixture feeds (reuse `demo/` fake feeds), trip finalisation,
  aggregates, API pagination/limits. **Acceptance**: 7 days of data; `line_daily` for C5
  Madrid matches a hand check of 20 trips.

## C4 — Android app, Free (branch `phase/c4-android`)

- **Capacitor** shell in `app/` (`capacitor.config.ts`, `app/android/`), loading the built
  `web/` bundle (engine + `.bin` data) from the APK, so the map opens offline-fast.
  Package id `com.structuralwizard.trainradar` (maintainer to confirm). Min SDK 26.
- One web codebase, build flag `TARGET=android` (`tools/build-web.sh --target android`)
  that sets `CONFIG.platform = "android"`: hides the coffee link, shows Pro entry points.
- Native plugins: Geolocation, Local Notifications, Preferences, Share, App, Status Bar,
  SplashScreen. Location: foreground only, permission asked only on "Use my location".
- Free tier = everything the web has today **minus the enthusiast layers** (see C5), plus:
  up to **2 favourites** (stations or trains), station board, nearest stations,
  "Am I on this train?".
- Android back button, deep links `trainradar://train/<no>`, `…/station/<id>`.
- CI: `android.yml` builds a debug APK on PRs (no secrets). Release AAB built **locally**
  by the maintainer at first (upload key never in the repo; Play App Signing on). Later,
  with approval, an upload-key secret for a `release-android.yml` on tags only.
- **Tests**: browser tests run with `TARGET=android`; an Espresso/UI smoke test that the
  map renders and a train popup opens on the demo feeds.

## C5 — Pro + tips (branch `phase/c5-pro`)

**Billing**: Google Play Billing via `cordova-plugin-purchase` (Capacitor-compatible) or a
thin custom plugin around Play Billing Library 7+. No third-party billing service, no
accounts, no server-side entitlement (the app is open source; client-side gating is
accepted by the maintainer). Products:

| Product id | Type | Price (ES) |
|---|---|---|
| `pro_monthly` | auto-renewing subscription | €1.99 |
| `pro_yearly` | auto-renewing subscription, 7-day free trial | €14.99 |
| `pro_lifetime` | one-time, non-consumable | €29.99 |
| `tip_small` / `tip_medium` / `tip_large` | consumable, unlocks nothing | €1.99 / €4.99 / €9.99 |

Entitlement cached in Preferences, refreshed from Play on start; "Restore purchases" in
Settings. Pro screen lists features honestly, shows price from Play, links to the store's
subscription management. **No external payment or donation links inside the app.**

**Pro features** (all run on the device; no new server cost except reading `summary.json`):

1. **Unlimited favourites** and **Commute mode**: saved origin → destination; app opens on
   those trains and next departures.
2. **My trips log**: when "Am I on this train?" reaches high confidence, or the user taps
   "I'm on this train", store the run locally (SQLite via `@capacitor-community/sqlite`):
   train, date, scheduled vs live arrival, delay at each stop. Stats: % late, average delay,
   per month. Location samples are **not** stored, only the matched train and times.
   Delete-all button.
3. **Compensation helper**: from a logged trip, a ready-to-copy summary (train no., date,
   origin/destination, scheduled vs actual arrival, delay) and a link to Renfe's official
   claims page. Wording: "check Renfe's current conditions"; never states eligibility.
4. **Export**: trips CSV and a shareable PNG card of a train's delay (Share plugin).
5. **Delay alerts**: per favourite train or commute, local notifications when delay crosses
   a threshold (default 5 / 15 min) or the train is cancelled. Background check every
   15 min via WorkManager (Capacitor Background Runner or a small native worker) reading
   `summary.json`; while the app is open, live from the engine. No push server, no tokens.
6. **Home-screen widget** (native Kotlin, Jetpack Glance): next trains of the commute /
   favourite trains with delay colour, from `summary.json`, refreshed ≥ 15 min.
7. **Enthusiast pack**: gradient + height profile, line speed, electrification and track
   count, spacing ahead/behind, satellite base map as default. (Free on the web.)
8. **Full history**: line/train/station punctuality charts from the C3 API (7 days free,
   up to 12 months Pro).
9. Themes, alternative app icons, custom delay colour thresholds.

**Tests**: entitlement state machine (none → trial → active → grace → expired; lifetime;
restore), Play Billing test tracks with licence testers, trips-log matching on fixtures,
CSV/summary formatting, notification threshold logic.

## C6 — Store release prep (branch `phase/c6-release`)

- Store listing texts ES/EN (title without "Renfe": e.g. "TrainRadar: trenes en directo"),
  short/long descriptions, screenshots from the demo feeds, feature graphic.
- **Data safety form** answers in `docs/play-data-safety.md` (expected: no data collected
  or shared; location processed on device only; purchases handled by Google Play).
- Content rating questionnaire answers, target audience 18+ not required (general).
- Closed test track: checklist for the testers requirement for new personal accounts.
- In-app "About & licences" screen with all attributions from `docs/data-sources.md`.
- Versioning: `versionCode` from tag, release notes from CHANGELOG.

## C7 — Optional, only if the maintainer says go: ads in the free Android app

AdMob banner in list views only (never over the map), a certified CMP (Google UMP SDK) for
EEA/UK consent, removed for Pro. Updates privacy policy and data safety form (ads = data
collected/shared). Web stays ad-free. Off by default behind `CONFIG.ads = false`.

---

## 6. Legal checklist

Claude Code drafts the pages and listings; **the maintainer** does the items marked 👤 and
should have the drafts checked by a professional. Not legal advice.

- 👤 Register as a sole trader with HMRC (self-assessment) before income; keep records of
  store payouts. Stores are merchant of record and handle VAT on sales.
- 👤 Google Play payments profile and **trader status** declaration (EU Digital Services
  Act): as a trader, your name, address, email and phone are shown to EU users. Consider a
  business address service and a dedicated email/phone.
- 👤 Check the name "TrainRadar" on UKIPO, EUIPO and in the Play Store for conflicts
  before launch.
- **Provider identification** page (UK E-Commerce Regulations 2002: name, geographic
  address, email).
- **Privacy policy** (UK GDPR / EU GDPR): what the app does *not* collect; location on
  device only; trips log on device only; purchases processed by Google (link to its
  policy); history API holds no personal data; server logs: Cloudflare request logs only,
  none kept by TrainRadar; contact for rights requests.
- **Terms of use**: information only, data may be wrong or late, never for safety-critical
  use; not affiliated with Renfe, Adif, OUIGO; subscriptions handled by Google Play
  (cancellation, refunds per Play policy); open-source licence notice.
- **Trademarks**: no Renfe/Adif logos or names in the app name or icon; "datos abiertos de
  Renfe" only in descriptions with the not-affiliated statement.
- **Data licences**: keep every attribution (Renfe CC BY 4.0 with "processed by
  TrainRadar", NAP/MITRAMS for OUIGO, OSM ODbL for track files, IGN CC BY 4.0, Copernicus
  notice, OpenFreeMap/OpenMapTiles). The published history is a derived work of CC BY data:
  attribute it the same way. 👤 Read `data.renfe.com/legal` and the NAP licence for
  commercial-use conditions (still an open item in `docs/data-sources.md`), and
  OpenFreeMap's terms for app traffic.

## 7. Data management

- **Personal data**: none on servers by design. Trips log, favourites, location: device
  only, deletable in Settings. Uninstall deletes everything.
- **History data**: D1 schema above; 24-month retention for trips, aggregates kept;
  weekly R2 backup (90 days); D1 Time Travel as short-term restore.
- **Quality**: store `source_quality`, skip stale feeds, flag OUIGO as timetable-only and
  never record it as live; document known Renfe quirks (alerts feed stalls, LD header
  timestamp offset) in `docs/data-sources.md`.
- **Optional, later**: publish monthly punctuality as an open dataset (CC BY 4.0) on the
  site, which doubles as marketing.

## 8. Cost management

| Item | Cost | Notes |
|---|---|---|
| Google Play developer account | $25 once | |
| Domain for `live.` / `api.` | ~£10/year | needed for cached R2 access |
| Cloudflare Workers Paid | $5/month | Durable Object alarms, headroom on requests and CPU; may fit free tier at first: measure in C1 |
| R2 | ~£0 | ~650k writes/month (within 1M free Class A); storage < 1 GB/year; CDN-cached reads are free |
| D1 | ~£0 | ~15k rows written/day, well inside included limits |
| Pages, OpenFreeMap tiles | £0 | |
| Apple developer (future iOS) | $99/year | not in this plan |
| **Running total** | **≈ £5/month + £10/year** | flat regardless of user count |

Controls (implement in C1/C3):
- Cloudflare billing/usage notifications at 50% and 80% of included limits (👤 set in
  dashboard; steps in `docs/deploy.md`).
- `status.json` + a GitHub Actions check every 30 min: fail (email via Actions) if any feed
  hasn't been fetched for 5 min or the recorder hasn't written for 15 min.
- Kill switch: `CONFIG.rtBase` can be pointed back at the proxy Worker by a config-only
  deploy; the poller has an env flag `POLLER_ENABLED`.
- Hard caps in code: max one Renfe fetch per feed per 15 s, API `days` ≤ 365, response size
  limits, history queries only on indexed keys.
- Monthly cost note in `docs/costs.md` (Claude Code creates the template; maintainer fills
  actuals).

## 9. Order and hand-off

C1 → C2 (feeds switch) → C3 → C2b (history teaser) → C4 → C5 → C6 → (C7 optional).
Each phase: its own branch and PR, tests and docs updated, `docs/roadmap.md` gets a
"C" section, stop for maintainer review before merging. Ask before any irreversible or
paid step (buying the domain, enabling Workers Paid, creating Play products, adding secrets).
