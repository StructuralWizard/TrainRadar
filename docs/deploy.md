# Deployment (Cloudflare, free tier)

The **Deploy** workflow (`.github/workflows/deploy.yml`) publishes:

| What | Where | Notes |
|---|---|---|
| Static site + reference data | Cloudflare Pages project `trainradar` → `https://trainradar.pages.dev` (or the subdomain Cloudflare assigns) | Created automatically on first deploy |
| CORS pass-through Worker | `https://trainradar-proxy.<your-subdomain>.workers.dev/` | Only the 5 Renfe feed paths, CORS only for the site's own URL |

It runs on every merge to `main`, nightly at 04:23 UTC (only if Renfe's
timetables changed or the data window needs moving), and manually from the
Actions tab. It never runs on pull requests, so PR code never sees the secrets.

## One-time setup

### 1. Cloudflare account

Free plan is enough. In the dashboard, open **Workers & Pages** once: that
creates your `*.workers.dev` subdomain, which the Worker needs.

### 2. API token (minimal permissions)

Cloudflare dashboard → **My Profile → API Tokens → Create Token → Create Custom Token**:

- **Token name:** `trainradar-deploy`
- **Permissions** (both *Account* level, nothing else):
  - `Account` · `Cloudflare Pages` · `Edit`
  - `Account` · `Workers Scripts` · `Edit`
- **Account Resources:** Include → *your account only*
- **Zone Resources:** none needed
- Optional: Client IP filtering (leave empty: GitHub runners have changing IPs),
  and a TTL if you want it to expire.

Copy the token once; Cloudflare won't show it again.

### 3. Account ID

Cloudflare dashboard → **Workers & Pages** → the right-hand panel shows
**Account ID**. (It's not secret, but keeping it as a secret keeps the
workflow simple.)

### 4. GitHub secrets

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the ID from step 3 |

Never paste these anywhere else (chat, issues, code).

Optional hardening: the jobs use the GitHub environment **production** (created
automatically). In **Settings → Environments → production** you can limit it
to the `main` branch, or require your approval before each deploy.

### 5. First deploy

Merge the A7 PR, or run **Actions → Deploy → Run workflow**. The run summary
shows the live URL and a smoke test of the live site.

## What gets cached

| Path | Cache |
|---|---|
| `data/*.bin.gz` (content-hashed) | 1 year, immutable |
| `data/manifest.json` | 5 min |
| `vendor/`, `icons/` | 1 day |
| everything else | `no-cache` (revalidated every load, cheap 304s) |

The data files are gzip-compressed at build time and decompressed in the
browser, so phones download the small size however they're served.

## Free-tier limits

- **Pages:** unlimited requests and bandwidth for static assets; 500 builds a
  month (we deploy from GitHub Actions, so builds aren't used).
- **Workers:** 100,000 requests a day. Each open tab polls about 4 feeds every
  30 s plus alerts every 2 min, ≈ 510 requests an hour, so the free tier covers
  roughly 195 viewing hours a day. Polling pauses in hidden tabs. If that's
  ever not enough, the paid Workers plan starts at $5/month.

## Central live poller (phase C1)

`backend/` fetches Renfe's feeds once for everyone and stores them in the R2 bucket
`trainradar-live`. It's deployed by `deploy.yml` (job "deploy the live poller") only
when the repository variable `LIVE_ENABLED` is `true`. Steps, in order:

1. **API token rights.** Cloudflare dashboard → My Profile → API Tokens → edit the
   token used for `CLOUDFLARE_API_TOKEN` and add:
   - `Account` · `Workers R2 Storage` · `Edit` (create the bucket, set its CORS rules)
   - `Account` · `Workers Scripts` · `Edit` is already there (it also covers the
     Durable Object).
   The secret's value doesn't change.
2. **R2.** Dashboard → R2 → enable R2 once (the free tier needs a card on file; usage
   stays inside the free tier, see [costs.md](costs.md)).
3. **Turn it on.** GitHub → Settings → Secrets and variables → Actions → Variables →
   New repository variable `LIVE_ENABLED` = `true` (a variable on the `production`
   environment works too), then run Actions → Deploy → Run
   workflow. The job creates the bucket, sets its CORS rules from
   `backend/r2-cors.json` and deploys the `trainradar-live` Worker.
4. **Check.** Open `https://trainradar-live.<your-subdomain>.workers.dev/rt/status.json`:
   every feed should show `"ok": true` and a `fetchedAt` from the last minute.
5. **Monitoring.** Add the repository variable `LIVE_BASE` with that URL (later the
   custom domain). The "Live check" workflow then runs every 30 min and fails (GitHub
   emails you) if a feed hasn't been fetched for 5 minutes.
6. **Custom domain (needs a domain, ~£10/year).** Once you've bought one and added it
   to Cloudflare: R2 → `trainradar-live` → Settings → Custom Domains → Connect domain →
   `live.<your-domain>`. Clients then read `https://live.<your-domain>/rt/...` from the
   CDN; cached reads don't count as Worker requests or R2 operations. Don't use the
   rate-limited `r2.dev` URL in production. Then set `LIVE_BASE` to the custom domain.
7. **Usage alerts.** Billing → Notifications: alerts at 50 % and 80 % of the included
   limits.

**Kill switch:** set `POLLER_ENABLED = "false"` in `backend/wrangler.toml` and deploy,
or delete the `LIVE_ENABLED` variable and remove the Worker in the dashboard. The site
keeps using the old pass-through Worker until phase C2 switches it, and it stays
deployed as the fallback.

## Site reads the live poller (phase C2)

The site reads the central poller's bucket only once it has a public, CDN-cached URL:
set the repository variable **`LIVE_PUBLIC_URL`** to the bucket's custom domain
(e.g. `https://live.<your-domain>`, step 6 above) and run Deploy. The site then:

- reads `rt/status.json` every 10 s and downloads a feed only when Renfe changed it;
- falls back to the pass-through Worker after 3 failures in a row, for 10 minutes;
- allows exactly those two origins in its Content-Security-Policy (the build checks).

Without `LIVE_PUBLIC_URL` the site keeps using the pass-through, as before. Don't point
it at the `workers.dev` address: every client read there is a Worker request (more than
the pass-through uses today), while reads through the custom domain come from the CDN.

**Kill switch:** delete `LIVE_PUBLIC_URL` and run Deploy: the site goes back to the
pass-through.

## Delay history (phase C3)

The same Worker also runs the **history recorder** (a second Durable Object running the
app's engine), the D1 database `trainradar-history` and the public, read-only API
`/v1/history/*` ([backend/README.md](../backend/README.md#delay-history-phase-c3)). It
stays off until you turn it on, because it needs a paid plan:

1. **Workers Paid ($5/month).** A recording cycle takes ~30–70 ms of CPU, over the free
   plan's 10 ms. Dashboard → Workers & Pages → Plans → Workers Paid. It also includes
   5 GB of D1, enough for the 12 months kept in the database.
2. **API token rights.** Add `Account` · `D1` · `Edit` to the deploy token (the secret's
   value doesn't change). R2 rights from C1 also cover the second, private bucket
   `trainradar-history` (backups and archives).
3. **Turn it on.** Repository variable `RECORDER_ENABLED` = `true`, then Actions →
   Deploy → Run workflow. The job creates the database (once), applies
   `backend/migrations/`, creates the private bucket with a 90-day expiry for
   `backups/` and a 14-day one for `gps/`, and deploys with the recorder on.
4. **Check.** `https://live.<your-domain>/rt/recorder.json` shows `"ok": true` and an
   `updatedAt` from the last 5 minutes; `rt/summary.json` lists every live train;
   `replay/<date>/<hour>.json.gz` (UTC) holds a frame a minute of every train as the map
   showed it, for the app's replay (TrainRadar Pro), and `replay/first.json` the first
   hour. About 3–10 MB a day gzipped (1–4 GB a year) in the live bucket: inside R2's
   free 10 GB for the first years, then about $0.015 per GB-month; one write every 5
   minutes. Repository variable `REPLAY_ENABLED` = `false` stops it.
   `notices/<date>.json` (Madrid date) lists every Renfe notice seen active that day,
   with when it was first and last seen, for the app's notices history (TrainRadar Pro),
   and `notices/first.json` the first day: a few KB a day, rewritten when a notice
   appears or changes and otherwise every 10 minutes.
   `rt/fixes.tsv` says since when each AV/LD/MD GPS position has stayed put (that feed
   gives positions no time: apps use it so a frozen position isn't taken as fresh). The
   "Live check" workflow also checks the recorder (stale over 15 min, an error, or the
   database over 4 GB) once `RECORDER_ENABLED` is set.
   `trainradar-history/gps/<date>/<hour>.ndjson.gz` (private) logs every train's raw
   GPS fix, at most one a minute per train, to check the track network later; kept 14
   days. `rt/recorder.json` shows how many fixes the current hour holds (`last.gps`).
5. **API domain (optional).** Workers & Pages → `trainradar-live` → Settings → Domains &
   Routes → Add → Custom domain → `api.<your-domain>`. The API then answers at
   `https://api.<your-domain>/v1/history/lines?days=7` (also on the `workers.dev` URL).
6. **Site domain (optional).** Workers & Pages → `trainradar` (the Pages project) → Custom
   domains → Set up a custom domain → `mytrainradar.com` (and again for
   `www.mytrainradar.com`). Cloudflare adds the DNS records itself when the domain is on
   Cloudflare. Both addresses are already allowed by the live bucket's CORS
   (`backend/r2-cors.json`), the poller and API (`backend/wrangler.toml`) and the
   pass-through (`deploy.yml`). The site also stays on `trainradar.pages.dev`.

**Data kept:** every finished run in `trips` for 12 months (then moved to the archive),
daily per-line and per-station figures forever. Daily backups in
`trainradar-history/backups/days/` (kept 90 days), one archive file per month in
`trainradar-history/archive/` (never deleted). Raw GPS fixes in
`trainradar-history/gps/` (kept 14 days). D1 Time Travel restores the last 30 days.

**Kill switch:** delete `RECORDER_ENABLED` (or set it to anything else) and run Deploy:
the recorder stops after its next cycle; the API keeps serving what's stored.

### History teaser on the site (phase C2b)

Train popups show the line's punctuality over the last 7 days (share on time, 5+ min
late, median delay, runs recorded), read from the history API. Set the repository
variable **`API_PUBLIC_URL`** = `https://api.<your-domain>` (step 5 of "Delay history")
and run Deploy; the build adds that origin to the CSP. Without it the teaser stays
hidden. It's also hidden for a line with fewer than 5 recorded runs, and when the API
doesn't answer. One request per line per page load, cached for an hour at the edge.

### App and coffee links

`web/js/config.js` has `playUrl` (Google Play listing) and `coffeeUrl` ("Invítame a un
café", web only). Both are empty, which hides every link, the app banner and the
"delay alerts → Android app" link in train popups. Fill them in once the listing / page
exists.

### Legal pages

`web/legal/` holds the privacy policy, terms, provider identification and data licences
(ES + EN), linked from the About panel (ⓘ), with Metranos Ltd's details (company
16886706, 128 City Road, London EC1V 2NX; support@metranos.com; English law). They are
drafts written without legal advice: have them reviewed before publishing the Android
app, and update the "last updated" dates when they change.

## Ireland (docs/europe/ie.md)

- **Turning it on:** set the repository (or production environment) variable **`IE_ENABLED`** =
  `true`.
- **What the deploy then builds:**
  - `data/ie/` from Irish Rail's timetable (the NTA's GTFS, no key) and Ireland's OpenStreetMap
    track;
  - `data/ie/plan/`, as far as the NTA publishes (about 3 weeks).
- **Daily rebuild:** with Ireland on, the deploy rebuilds daily, because the live feed only matches
  the same day's file.
- **If Ireland's build fails,** the rest of the site still deploys.
- **Live data:** once the GitHub secret `IE_NTA_API_KEY` exists, the `eu` job deploys
  `backend-eu/`, which writes `ie/rt/` on the live domain ([backend-eu/README.md](../backend-eu/README.md)).
  Check `ie/rt/status.json` there.
- **The UK ingest** redeploys only when `backend-uk/` changed, or from Run workflow. Each restart
  risked Network Rail refusing its login for a while (AMQ339009).
- **Where it shows:**
  - while it's being built, Ireland is a hidden country (`hiddenCountries` in `web/js/config.js`);
  - the site opens it only from `?country=ie`, and the Android app not at all;
  - to offer it to everyone, move `"ie"` into `countries`.

## France and Luxembourg (docs/europe/fr.md, docs/europe/west-central.md)

- **Turning them on:** set the variables **`FR_ENABLED`** = `true` and **`LU_ENABLED`** = `true`.
  Neither needs a key.
- **What the deploy then builds:**
  - `data/fr/`: SNCF's timetable, one national region (TGV INOUI, OUIGO, Intercités, Lyria, ICE)
    and one per TER area, on France's OpenStreetMap track; and `data/fr/plan/`, 9 weeks ahead;
  - `data/lu/`: CFL's trains from Luxembourg's national GTFS, by timetable.
- **The first France build is slow:** Geofabrik's France extract is about 5 GB. The filtered track
  is then cached for the week.
- **Daily rebuild** with either on: SNCF publishes changes (strikes, works) the evening before.
- **Live data (France):** with `FR_ENABLED`, the `eu` job deploys `backend-eu/`, which writes
  `fr/rt/` every minute. Check `fr/rt/status.json` on the live domain.
- **Where they show:** hidden countries, opened only with `?country=fr` or `?country=lu`.
- **Testers:** once a device has opened any hidden country from its link, "Ir a…" and the network
  picker list every hidden country, marked *en pruebas* / *testing*.
- **Each deploy checks them:** the live smoke test opens every deployed country's `?country=` link
  and reports `country xx: OK, N trains` (or `FAIL`) in the run summary, without failing the deploy.
- **OpenStreetMap down:** if Geofabrik can't be reached after retries, a country is built without
  its track (trains drawn on straight lines between stations) instead of being left out.

## Switzerland, Sweden and Poland (M3, M5)

- **Turning them on:** **`CH_ENABLED`**, **`SE_ENABLED`**, **`PL_ENABLED`** = `true`, with their
  keys in GitHub (docs/europe/registrations.md). Each builds `data/ch/`, `data/se/`, `data/pl/`
  daily; a failure leaves that country out of the deploy and never stops the rest.
- **Live data:** Switzerland's trip updates and alerts (`ch/rt/`) and Poland's live running
  (`pl/rt/`, PKP PLK's JSON turned into GTFS-Realtime by the Worker) come from the `eu` job's
  Worker, which gets the keys as Worker secrets. Sweden goes by timetable for now: its live
  feeds come per region, mixed with buses (the PR's Refdata run measures them).
- **Tested on pull requests:** the Refdata workflow builds the three countries and calls each
  live source once through the Worker's own code (`tools/feed-check/eu-probe.mjs`), reporting
  how many live trips match the timetable. Approved by the maintainer (AGENTS.md).
- **Where they show:** hidden countries, `?country=ch`, `?country=se`, `?country=pl`.

## Slovakia and Estonia (M4)

- **Turning them on:** **`SK_ENABLED`** and **`EE_ENABLED`** = `true`. No keys, no live data: trains
  go by timetable, and nothing is deployed to the live Worker.

## Finland, Norway and the Netherlands (M2)

- **Turning them on:** the variables **`FI_ENABLED`**, **`NO_ENABLED`** and **`NL_ENABLED`** = `true`.
  No keys.
- **What the deploy then builds:** `data/fi/`, `data/no/` and `data/nl/`, each with its `plan/`, on
  the country's OpenStreetMap track. `tools/fetch-eu.sh` downloads each country's timetable and,
  for Norway and the Netherlands, cuts it to trains with `tools/gtfs-rail.py`.
- **Live data:** the `eu` job deploys `backend-eu/` with each switch; check `fi/rt/status.json`,
  `no/rt/status.json` and `nl/rt/status.json` on the live domain.
- **Set the variables before merging** (or run the Deploy workflow afterwards): the live Worker
  only reads them when it's deployed.
