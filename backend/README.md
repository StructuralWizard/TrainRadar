# TrainRadar live backend (phase C1)

One central client for Renfe's GTFS-RT feeds instead of one per open tab.

- **Poller** (`src/poller.js`, a Durable Object with an alarm): fetches each feed on
  its own cadence with a conditional GET, and writes the bytes **unchanged** to the R2
  bucket `trainradar-live` as `rt/<feed>.pb` (`Cache-Control: public, max-age=10`).
  It also writes `rt/status.json`.

  | Feed | Cadence |
  |---|---|
  | `vehicle_positions_LD.pb`, `trip_updates_LD.pb` | every 15 s |
  | `vehicle_positions.pb`, `trip_updates.pb` | every 20 s |
  | `alerts.pb` | every 2 min; every 5 min after an hour unchanged |

  Once three or more of Renfe's `Last-Modified` times are known, each feed is fetched
  ~2 s after its next expected change (phase-lock). Hard floor: one fetch per feed per
  15 s. Errors back off exponentially (max 10 min); ±1 s jitter. A 304 costs no R2
  write.
- **Cron** (every minute): re-arms the alarm if it ever stopped.
- **Worker `fetch`**: serves `rt/*` from R2 with CORS for the site and app origins.
  This is the staging path; in production, clients read the bucket through its custom
  domain, where cached responses don't invoke the Worker at all.
- **Kill switch**: `POLLER_ENABLED` (anything but `"true"` stops all fetching).

## `rt/status.json`

```json
{
  "generatedAt": "2026-11-03T08:00:02.000Z",
  "pollerEnabled": true,
  "feeds": {
    "vehicle_positions_LD.pb": {
      "renfeLastModified": "Tue, 03 Nov 2026 08:00:00 GMT",
      "fetchedAt": "2026-11-03T08:00:02.000Z",
      "ok": true,
      "bytes": 9012,
      "changeGapS": 17,
      "nextAt": "2026-11-03T08:00:19.000Z"
    }
  }
}
```

`changeGapS` is the measured median gap between Renfe's updates of that feed, so a
change of cadence on Renfe's side shows up here.

## Tests

```sh
node --test backend/test/*.test.mjs
```

The tests mock Renfe (200, 304, 5xx, timeout), R2 and the Durable Object storage.

## Deploy

See [docs/deploy.md](../docs/deploy.md#central-live-poller-phase-c1). The poller is
deployed by `deploy.yml` only after the repository variable `LIVE_ENABLED` is `true`.
