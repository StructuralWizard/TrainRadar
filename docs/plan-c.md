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
        each feed on its own cadence (15–20 s, alerts 2–5 min), conditional GETs
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
- **Poller**: a Durable Object with one alarm schedule **per feed**, matched to how often
  Renfe actually changes it (from `docs/data-sources.md`, verified 2026-11-01):

  | Feed | Renfe official refresh | Measured change gap | Poll |
  |---|---|---|---|
  | `vehicle_positions_LD.pb` | 15 s | ~17 s | every 15 s |
  | `trip_updates_LD.pb` | — | ~15 s | every 15 s |
  | `vehicle_positions.pb` (Cercanías) | 20 s | ~21–25 s | every 20 s |
  | `trip_updates.pb` (Cercanías) | 20 s | ~18–21 s | every 20 s |
  | `alerts.pb` | 20 s (in practice stalls for days/weeks) | no change in 3 min | every 2 min; every 5 min after 1 h unchanged |

  Rules: conditional GET (`If-None-Match`/`If-Modified-Since`; Renfe sends `Last-Modified`)
  so unchanged feeds cost a 304 and no R2 write; **phase-lock** to Renfe: once a few
  `Last-Modified` values are known, schedule the next fetch ~2 s after the expected change
  instead of a blind timer; never faster than 15 s per feed; ±1 s jitter; exponential
  backoff per feed on errors (max 10 min). On 200 write the bytes unchanged to R2
  `rt/<name>.pb` with `Cache-Control: public, max-age=10`.
  This is one client for all users: ~4 requests per 15–20 s, about the same as **one** open
  browser tab today, and far below Renfe's own `Cache-Control: max-age=30` per client.
  Log the measured change gaps weekly to `status.json` and adjust if Renfe changes cadence.
- **Other sources are not polled live**: OUIGO is timetable-only (NAP GTFS, nightly CI);
  Renfe GTFS timetables nightly (ETag check, existing deploy job); OSM, IGN and Copernicus
  at most weekly in CI. No Adif realtime feed is used.
- A cron trigger every minute only (re)arms the alarms if they died.
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
- Client polling: fetch `status.json` every 10 s (tiny, CDN-cached) and download a `.pb`
  only when its `renfeLastModified` changed, instead of fixed 30 s timers. Users see new
  positions within ~10–15 s of Renfe publishing them, and unchanged feeds aren't
  re-downloaded. Keep the pause when the tab is hidden.
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
- **Expected volume** (estimate, verify in the first week): ~6,000–7,000 runs/day at
  ~0.6–1 KB each with stop delays → **4–8 MB/day, 0.15–0.25 GB/month, 1.5–3 GB/year** in
  D1. ~10–15k rows written/day. Add a daily job that logs D1 size and row counts to
  `rt/status.json` so growth is visible.
- **Tiered retention** (a single D1 database is capped at 10 GB; the paid plan includes
  5 GB): keep `trips` in D1 for the **last 12 months**. A monthly cron exports each month
  older than 12 months to R2 `archive/trips/YYYY-MM.ndjson.gz` (~1/5 of the D1 size) and
  then deletes those rows. `line_daily` stays in D1 forever (tiny). The API serves `days`
  ≤ 365 from D1 only; older months are downloadable archives (later: open dataset).
  Alert at 4 GB D1 size (80% of included storage).
- Backups: weekly export of D1 to R2 `backups/` (gz NDJSON), R2 lifecycle deletes backups
  after 90 days; D1 Time Travel for short-term restore. Archives in `archive/` are never
  auto-deleted.
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
| `pro_monthly` | auto-renewing monthly subscription, **no free trial at launch** | €1.99 |
| `tip_small` / `tip_medium` / `tip_large` | consumable, unlocks nothing | €1.99 / €4.99 / €9.99 |

**Launch with monthly only.** Yearly and lifetime are **not** created in Play Console and not
shown in the app until phase C8 (see below). Monthly keeps the exposure on closure to at most
one month per subscriber. Code the paywall and entitlement logic so more products can be
added later from a config list without UI changes (`CONFIG.products`), but ship only
`pro_monthly` + tips. Prices are set in Play Console (Spain €1.99 incl. VAT; UK and other
markets via Play's per-product local price conversion (templates ended Oct 2025), maintainer to confirm).

Entitlement cached in Preferences, refreshed from Play on start and on resume; "Restore
purchases" in Settings (a Pro purchase follows the user's Google account to any phone).
Grace period / account hold handled per Play states. Pro screen lists features honestly, shows price from Play, links to the store's
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

**On-device storage and backup** (applies to Free and Pro data):

- All user data lives in native storage that Android backs up: trips log, favourites,
  commute routes and alert rules in SQLite (`@capacitor-community/sqlite`, database
  domain); settings and cached entitlement in Capacitor Preferences (shared prefs).
  **Do not** keep user data only in the WebView's `localStorage`/IndexedDB (not reliably
  backed up). Cache files (map tiles, `.bin` data, `summary.json`) go in cache dirs and are
  excluded.
- **Android Auto Backup** enabled explicitly: `android:allowBackup="true"`,
  `android:dataExtractionRules` (API 31+) and `android:fullBackupContent` (API ≤ 30), both
  including the SQLite database and shared prefs and excluding caches. Backups go to the
  user's own Google Drive (private app folder, not counted in their quota, end-to-end
  encrypted on Android 9+ with a screen lock), about once a day, and are restored
  automatically on reinstall or a new phone. Keep user data well under the 25 MB per-app
  limit (expected: a few hundred KB after years of trips).
- **Manual Export/Import** in Settings (Free and Pro): one versioned JSON file
  (`trainradar-backup-YYYYMMDD.json`, schema version, trips, favourites, commutes, alert
  rules, settings; no location samples) saved through the Android share sheet / Storage
  Access Framework, so the user can put it in Drive or move phones immediately. Import
  validates the schema and merges without duplicates.
- Settings shows "Last automatic backup: managed by Android" info text and the
  Export/Import buttons; "Delete all my data" wipes SQLite + prefs.
- Schema migrations for the SQLite database from day one (restored backups may be older).

**Tests**: entitlement state machine (none → active → grace → on hold → expired;
restore on a new install), Play Billing test track with licence testers, trips-log matching
on fixtures, CSV/summary formatting, notification threshold logic, export → wipe → import
round trip, `adb shell bmgr backupnow` + reinstall restore test, migration from an older
backup schema.

## C6 — Store release prep (branch `phase/c6-release`)

- Store listing texts ES/EN (title without "Renfe": e.g. "TrainRadar: trenes en directo"),
  short/long descriptions, screenshots from the demo feeds, feature graphic.
- **Data safety form** answers in `docs/play-data-safety.md` (expected: no data collected
  or shared; location processed on device only; purchases handled by Google Play).
- Content rating questionnaire answers, target audience 18+ not required (general).
- Closed test track with real testers (useful even though an organisation account
  should be exempt from the personal-account testing requirement); publisher name
  "Metranos Ltd" in the listing and in the app's About screen.
- In-app "About & licences" screen with all attributions from `docs/data-sources.md`.
- Versioning: `versionCode` from tag, release notes from CHANGELOG.

## C8 — Later: yearly and lifetime (only after ≥ 2 months of stable paid service)

Not part of the first release. Start only when the maintainer says go, and only if: the
backend has run ≥ 2 months with ≥ 99% uptime, costs match section 8, and there are no open
billing or entitlement bugs. Then add `pro_yearly` (e.g. €14.99, optional 7-day trial) and
possibly `pro_lifetime` (e.g. €29.99) via `CONFIG.products`, update the Pro screen, terms
(lifetime = for as long as the service is offered, see wind-down clause) and the DMCC
checks (end-of-trial and renewal reminders). Re-run the billing tests with the new products.

## C7 — Optional, only if the maintainer says go: ads in the free Android app

AdMob banner in list views only (never over the map), a certified CMP (Google UMP SDK) for
EEA/UK consent, removed for Pro. Updates privacy policy and data safety form (ads = data
collected/shared). Web stays ad-free. Off by default behind `CONFIG.ads = false`.

---

## 6. Legal checklist

Claude Code drafts the pages and listings; **the maintainer** does the items marked 👤 and
should have the drafts checked by a professional. Not legal advice.

**Publisher: Metranos Ltd** (UK limited company, maintainer's existing company). The app,
store accounts, Cloudflare billing, domain and insurance are all in the company's name.

- 👤 Open the Google Play developer account as an **organisation** (Metranos Ltd), not a
  personal account; D-U-N-S number needed. Payments profile and payouts to the company
  bank account. Organisation accounts are exempt from the personal-account closed-testing
  requirement (verify at sign-up).
- 👤 **Trader status** declaration (EU Digital Services Act): use the company's registered
  office address and a business email/phone, never a home address.
- 👤 **Tax**: store payouts are company trading income in the Corporation Tax return.
  Google is the seller to consumers and accounts for UK/EU VAT on store sales, so no
  Spanish or EU VAT registration is expected; confirm treatment of Google payouts and of
  web tips (Buy Me a Coffee) with the company's accountant.
- 👤 **Insurance** (not legally required unless the company employs someone; recommended
  once paid features launch): professional indemnity £250k–£1m plus legal expenses,
  territory including Spain/EU, covering software supplied to consumers. Typical small
  policies ~£100–£250/year. Public liability and cyber cover are low priority because the
  servers hold no personal data.
- 👤 **ICO data-protection fee**: check whether Metranos Ltd must pay it (likely if the
  company processes any personal data, e.g. support emails); low annual fee.
- **Free vs paid, consumer law**: the free app and web carry little consumer-law exposure.
  Paid Pro must be of satisfactory quality and as described (UK Consumer Rights Act 2015;
  EU digital-content rules apply to Spanish buyers). Consumers' statutory rights can't be
  excluded; the "data may be wrong, not for safety-critical use" notice still applies.
- **UK subscription rules (DMCC Act) from January 2027**: before selling `pro_monthly` to
  UK users after that date, check pre-contract information, renewal reminders and easy
  cancellation (end-of-trial reminders become relevant only if a trial is added in C8).
  Play Billing covers much of this; the Pro screen must show price, renewal period and how
  to cancel.
- 👤 Check the name "TrainRadar" on UKIPO, EUIPO and in the Play Store for conflicts
  before launch.
- **Provider identification** page (UK E-Commerce Regulations 2002 and Companies Act
  disclosure): Metranos Ltd, company number, registered office, email.
- **Privacy policy** (UK GDPR / EU GDPR): what the app does *not* collect; location on
  device only; trips log on device only; purchases processed by Google (link to its
  policy); history API holds no personal data; server logs: Cloudflare request logs only,
  none kept by TrainRadar; contact for rights requests.
- **Terms of use**: information only, data may be wrong or late, never for safety-critical
  use; not affiliated with Renfe, Adif, OUIGO; subscriptions handled by Google Play
  (cancellation, refunds per Play policy); open-source licence notice; **wind-down
  clause**: if the service closes or Pro is withdrawn, at least 60 days' notice in the app
  and on the website, renewals cancelled, and pro-rata refunds of unused paid time.
- **Wind-down procedure** (`docs/wind-down.md`, Claude Code drafts it): stop new sales →
  in-app and web notice (≥ 60 days) → cancel all subscriptions in Play Console so they don't
  renew → partial refunds of unused time per order (Play supports partial refunds for
  subscriptions; refunded share reduces payout and Google's fee proportionally) → final
  app release whose on-device features (trips log, export, favourites) keep working and
  which can fall back to the open-source proxy → publish the history archive as open data.
- **Trademarks**: no Renfe/Adif logos or names in the app name or icon; "datos abiertos de
  Renfe" only in descriptions with the not-affiliated statement.
- **Data licences**: keep every attribution (Renfe CC BY 4.0 with "processed by
  TrainRadar", NAP/MITRAMS for OUIGO, OSM ODbL for track files, IGN CC BY 4.0, Copernicus
  notice, OpenFreeMap/OpenMapTiles). The published history is a derived work of CC BY data:
  attribute it the same way. 👤 Read `data.renfe.com/legal` and the NAP licence for
  commercial-use conditions (still an open item in `docs/data-sources.md`), and
  OpenFreeMap's terms for app traffic.

## 7. Data management

- **Personal data**: none on TrainRadar's servers by design. Trips log, favourites,
  location: device only, deletable in Settings. Lost or new phone: Android Auto Backup
  restores the data from the user's own Google Drive (encrypted, managed by Android, not
  readable by Metranos Ltd), plus manual Export/Import; the Pro purchase is restored from
  Google Play. The privacy policy explains this.
- **History data**: D1 schema above; 12 months of trips in D1, older months archived to
  R2 as monthly gz files, aggregates kept in D1; weekly R2 backup (90 days); D1 Time Travel
  as short-term restore. Expected 4–8 MB/day (see C3).
- **Live data**: ~100 KB of feed files in R2, overwritten every cycle (no growth).
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
| Cloudflare Workers Paid | $5/month | includes 10M Worker requests, 1M Durable Object requests + 5 GB DO storage, D1 5 GB storage + 50M rows written/month. Enable at dash.cloudflare.com → Workers & Pages → Plans. May fit the free tier at first: measure in C1 |
| R2 | ~£0 | free tier 10 GB storage, 1M writes, 10M reads/month; ~650k writes/month for live feeds; archives ~0.3–0.6 GB/year; CDN-cached reads are free |
| D1 | ~£0 for ~2 years | 4–8 MB/day; 12-month window ≈ 1.5–3 GB, inside the 5 GB included; extra storage $0.75/GB-month |
| Professional indemnity + legal expenses insurance | ~£100–£250/year | Metranos Ltd policy, see section 6 |
| Pages, OpenFreeMap tiles | £0 | |
| Apple developer (future iOS) | $99/year | not in this plan |
| **Running total** | **≈ £5/month + £10/year domain + insurance** | flat regardless of user count |

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

C1 → C2 (feeds switch) → C3 → C2b (history teaser) → C4 → C5 → C6 → launch with
`pro_monthly` + tips → ≥ 2 months → C8 (yearly/lifetime) → (C7 optional, any time after C6).
Each phase: its own branch and PR, tests and docs updated, `docs/roadmap.md` gets a
"C" section, stop for maintainer review before merging. Ask before any irreversible or
paid step (buying the domain, enabling Workers Paid, creating Play products, adding secrets).
