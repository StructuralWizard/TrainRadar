# TrainRadar live backend (phases C1 and C3)

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

## Delay history (phase C3)

Off until `RECORDER_ENABLED` is `"true"` (set by the deploy job from the repository
variable of the same name; it needs Workers Paid and D1, see
[docs/deploy.md](../docs/deploy.md#delay-history-phase-c3)).

- **Recorder** (`src/recorder.js`, `src/recorder-do.js`; a second Durable Object, so
  it can never stop the poller): keeps the app's own engine (WebAssembly, `web/pkg`)
  in memory with every region and its track geometry loaded (~20 MB), reading the
  reference data from the deployed site (`REFDATA_BASE`; reloaded within the hour
  after a redeploy). Every 60 s it ingests the feeds the poller changed in R2 and:
  - writes each **finished run** to D1 `trips`: delay at every stop the train was seen
    reaching, at arrival, maximum; Renfe's figure (`renfe_tu`) or our GPS estimate
    (`gps_estimate`). A run is finished at its last stop, after 3 h unseen, or 3 h
    after its delayed arrival time;
  - writes **`rt/summary.json`**: every live train
    `{trainNo, line, product, delayMin, nextStopId, status, updatedAt}` (for the
    Android widget and alerts);
  - writes **`rt/recorder.json`** every 5 min (health, runs in progress, database size);
  - logs every new **raw GPS fix** (`src/gpslog.js`) to the private bucket
    `trainradar-history` as `gps/<date>/<hour>.ndjson.gz` (UTC), one fix per line:
    `[fix_time, key, number, feed, product, lon_e5, lat_e5, speed_kmh|null, prev_stop,
    next_stop, feed_stop]`. Positions exactly as Renfe's feeds give them, never placed
    on our track (the replay frames are), so the track network can be checked against
    where trains really ran. A fix is logged when its time or position changed; the
    hour file is written every 10 min. Deleted after 14 days (lifecycle rule
    `gps-14d`); `GPS_LOG_ENABLED` = `"false"` stops it. Only train data.
  Runs in progress are saved to the object's storage every 5 min, so a restart only
  loses a few minutes. Feeds the poller hasn't fetched for 10 min are treated as empty
  (nothing old is recorded); alerts aren't recorded.
- **Lines**: Cercanías by núcleo and line (`10-C5`, product `CERCANIAS`); other trains
  by their two terminal stop ids, either direction (`60000-71801`) and Renfe's product
  (`AVE`, `ALVIA`, `MD`…).
- **Daily job** (02:40 UTC, `src/history.js`): for the last two service days, the
  per-line (`line_daily`) and per-station (`station_daily`) figures, and a backup to the
  private bucket `trainradar-history` (`backups/days/YYYY-MM-DD.ndjson.gz`, expires after
  90 days). From the 3rd of each month, last month's archive
  (`archive/YYYY-MM.ndjson.gz`, never deleted). Runs older than 12 months leave D1 once
  archived; daily figures stay.
- **API** (`src/api.js`, read-only, `Cache-Control: public, max-age=3600`, CORS as
  above, cached at the edge):

  | Request | Answer |
  |---|---|
  | `GET /v1/history/lines?days=7` | every line: runs, on time (< 5 min), 5+ and 15+ min late, cancelled |
  | `GET /v1/history/line/10-C5?days=30` | one line, per day and product, with median and p90 delay |
  | `GET /v1/history/train/19?days=30` | every run of a train number, with its stops |
  | `GET /v1/history/station/18000?days=30` | one station, per day |

  `days` is 1–365 (default 7), ending yesterday (Madrid). Ids: letters, digits, `.`,
  `_`, `-`. Every query uses an index; at most 2,000 rows.

Schema: [`migrations/0001_history.sql`](migrations/0001_history.sql). Compared with the
plan: `last_delay_min` (for runs not seen arriving) and the `station_daily` table (so
station queries use an index instead of scanning every run's stops) were added; backups
are daily per-day files rather than a weekly full export, and the monthly archive is
built from them.

## Tests

```sh
cd backend && npm test   # node --import ./test/hooks.mjs --test test/*.test.mjs
```

The tests mock Renfe (200, 304, 5xx, timeout), R2 (with multipart uploads) and the
Durable Object storage; D1 is a real SQLite database (`node:sqlite`) with the
migrations applied. The recorder tests run the real engine on the demo data and skip
without `web/pkg` (`tools/build-wasm.sh`) and `demo/` (see `.github/workflows/ci.yml`).

## Deploy

See [docs/deploy.md](../docs/deploy.md#central-live-poller-phase-c1). The poller is
deployed by `deploy.yml` only after the repository variable `LIVE_ENABLED` is `true`;
the recorder runs only once `RECORDER_ENABLED` is `true` too.
