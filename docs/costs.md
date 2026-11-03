# Costs

Monthly running costs of TrainRadar, kept by the maintainer. Estimates come from
the plan ([plan-c.md](plan-c.md), section 8). Fill in the actuals from the Cloudflare
dashboard (Workers & Pages → Usage; R2 → Metrics; Billing) once a month.

| Month | Workers plan | Worker requests | DO requests | R2 Class A (writes) | R2 Class B (reads) | R2 storage | D1 storage | Domain | Total | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---|
| 2026-11 | Free / Paid ($5) | | | | | | | | | C1 poller started |

## Expected usage of the central poller (C1)

- **Renfe requests**: about 14 a minute in total (4 feeds every 15–20 s, alerts every
  2–5 min): ~20,000 a day, the same as one open browser tab used to make.
- **R2 writes (Class A)**: one per changed feed (~14/min) plus `status.json` (at
  most every 30 s unless something changed): roughly 600–700k a month, inside the
  free 1M.
- **Durable Object**: one alarm every ~5–15 s plus one cron call a minute:
  ~15,000 requests a day.
- **Client reads**: through the bucket's custom domain, cached reads are free and
  don't invoke a Worker. Through the `workers.dev` staging URL, every read is a
  Worker request (100,000/day on the free plan).

## Alerts to set (dashboard)

- Billing → Notifications: usage alerts at 50 % and 80 % of the included Workers,
  R2 and D1 limits.
