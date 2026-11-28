# Ops: alerts and the administrator dashboard

`backend-ops/` is a Cloudflare Worker, `trainradar-ops`, that only reads. Every 5 minutes it checks
every country's live feed and data, and mails when something breaks and again when it recovers. At
`https://ops.mytrainradar.com/`, behind Cloudflare Access, it serves a dashboard with the numbers in
one place. Everything is aggregate: there are no user accounts and nothing per person.

## Alerts (every 5 minutes)

From each country's `status.json` in the live bucket (`rules.js`):

| Alert | When |
|---|---|
| Ingest stopped | the status file not rewritten for 15 min |
| Feed failing | the country failing for 30 min (its error in the mail) |
| Feed not fetched | one feed (GPS, delays, alerts) not fetched for 30 min |
| Quota | calls today at 90 % of the country's daily cap |
| UK login | Network Rail's login failed 3 times in a row (backing off) |
| TfL | London's live arrivals failing |
| Old data | a country's reference data over 36 h old (the nightly deploy didn't refresh it); checked hourly from the site's manifests |

A country whose status is over 7 days old counts as switched off: no alerts. A problem is mailed
after two checks in a row (10 minutes), so a blip never mails, and once more when it has been gone
for two checks, with how long it lasted. Each mail also lists what is still open.

## Dashboard

- **Open alerts**, as above.
- **Live feeds**: per country, its state, when it last updated, calls today against its cap, each
  feed's last fetch and the trains it kept, and its error.
- **Reference data**: each country's build time and age.
- **Cloudflare** (GraphQL Analytics API, `cf.js`): Worker requests, errors and subrequests (24 h);
  R2 size, objects, reads and writes; D1 size and rows read and written; the website's visitors,
  page views and requests per day (7 days) and requests by country. These come from Cloudflare's
  own edge analytics: no script on the site, no cookies.
- **Google Play** (`play.js`): ratings and reviews of the last 7 days; crash and ANR rates (Android
  vitals); installs and subscriptions by country from Play's monthly reports, when
  `PLAY_REPORTS_BUCKET` is set.
- **Send a test alert**: mails `ALERTS_EMAIL_TO` once, to check the set-up.

Each panel loads on its own: one that fails shows its error and the others still show.

## Setting it up

1. **Email Routing**: Cloudflare dashboard → mytrainradar.com → Email → Email Routing → enable it.
   Under Destination addresses, add the address the alerts should go to and click the link in the
   mail Cloudflare sends.
2. **GitHub secret** `ALERTS_EMAIL_TO`: that address. `CLOUDFLARE_ANALYTICS_TOKEN` and
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` are already set. The token needs Account Analytics, Workers
   Scripts, Workers R2 Storage and D1, all read-only, plus Zone → Analytics: Read on
   mytrainradar.com for the website panel.
3. **Cloudflare Access**: Zero Trust → Access → Applications → Add → Self-hosted, domain
   `ops.mytrainradar.com`, with a policy allowing your email (one-time PIN or Google login). Then
   copy into GitHub's repository variables:
   - `ACCESS_TEAM_DOMAIN`: your team domain, e.g. `yourteam.cloudflareaccess.com` (Zero Trust →
     Settings → Custom pages).
   - `ACCESS_AUD`: the application's Application Audience (AUD) tag (the application → Overview).

   Until both are set, the dashboard refuses every request. The Worker checks Access's token itself,
   so a route that skipped Access would still show nothing.
4. **Optional:** `PLAY_REPORTS_BUCKET` (a variable): Play Console → Download reports → Statistics →
   Copy Cloud Storage URI (`gs://pubsite_prod_…`). Without it, the installs and subscriptions
   panels say so.
5. **Switch it on**: the repository variable `OPS_ENABLED` = `true`. The next deploy from main
   deploys the Worker on `ops.mytrainradar.com` (its own custom domain) and sets its secrets.

## Calls

Alerts: 16–18 reads from R2 every 5 minutes, and 25 small fetches of the site's manifests an hour.
Dashboard: one summary every 5 minutes at most while it's open (4 Cloudflare GraphQL queries and 4–6
Google API calls). Nothing calls a data provider.
