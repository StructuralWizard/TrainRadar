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
