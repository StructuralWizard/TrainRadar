# UK ingest Worker (plan 3, phase 3c)

Network Rail's live train movements (TRUST) for the app's United Kingdom view, kept apart
from `backend/` (Spain) so a UK problem never touches Renfe's poller or recorder.

Every minute a Durable Object alarm:

1. **Drains** the durable subscription `trainradar-uk` on `TRAIN_MVT_ALL_TOC` (`drain.js`):
   connect to `publicdatafeeds.networkrail.co.uk:61618` (STOMP, ActiveMQ Artemis), log in
   with `client-id: trainradar-uk`, subscribe with `durable-subscription-name`, read what the
   broker queued since the last minute until it's quiet (≤ 25 s), disconnect. The broker
   keeps queueing while we're away, so nothing is lost between minutes or across restarts.
2. **Updates the trains** (`trust.js`): an activation links TRUST's `train_id` to its schedule
   (UID, start date, STP indicator, service date); each movement sets the delay
   (actual − planned); cancellations at origin cancel the run; trains are forgotten 4 h
   after their last news or 30 min after they terminate.
3. **Writes** to the live bucket (`cycle.js`), served from the same live domain as Spain's:
   - `uk/rt/trip_updates.pb`: GTFS-Realtime TripUpdates (`gtfsrt.js`), one per running
     train, trip id `UID:start date:STP` as in the timetable built by `refdata-build`
     (`--uk-schedule`), so the app's engine matches them like Renfe's. TRUST is reported
     to swap the P and O indicators, so both ids are published; only one exists.
   - `uk/rt/status.json`: last drain (frames, messages, bytes, time), trains, delays,
     cancellations, errors. Never the login.

4. **National Rail incidents** (`kb.js`), every 5 minutes when `NATIONAL_RAIL_KB_KEY` is set:
   the Knowledgebase incidents XML (Rail Data Marketplace, NRE incident schema v5) →
   `uk/rt/incidents.json` `{ updatedAt, source, notice, incidents: [{ id, summary, text,
   routes, operators, planned, priority, from, until, updated, url }] }`: incidents not
   cleared and not over, unplanned first. HTML is reduced to plain text; only links to
   `www.nationalrail.co.uk` are kept. The licence (docs/licenses/) asks for a credit to the
   Rail Delivery Group, without implying endorsement, and an accuracy notice: both are in
   the file (`source`, `notice`) for the app to show. A failed fetch keeps the last file.

A failed drain (login refused, network) keeps the last `trip_updates.pb` and says why in
`status.json`. Measured volumes: about 424 TRUST messages and 300 KB a minute at peak
(docs/data-sources-uk.md).

## Settings

- `UK_ENABLED` (wrangler var): the kill switch; the deploy job sets it `true`.
- `NETWORK_RAIL_USERNAME`, `NETWORK_RAIL_PASSWORD`, `NATIONAL_RAIL_KB_KEY`: Worker secrets,
  put by the deploy job from the GitHub Actions secrets of the same names (stdin, never the
  command line). Without the KB key there are no incidents; everything else runs.
- Deploy: the `uk` job in `.github/workflows/deploy.yml`, only when the repository (or
  production environment) variable `UK_ENABLED` is `true`.

## Tests

`node --test backend-uk/test/*.test.mjs`: the STOMP client against a fake broker, TRUST
messages in their real shape, the GTFS-Realtime encoding (decoded back), a drain on a fake
broker (durable headers, never unsubscribes), and a full cycle writing to a fake bucket,
including a refused login.
