# Europe ingest Worker (docs/plan-europe.md, A5)

The live feeds of countries added after Spain and the UK, fetched once for everyone and written to
the shared live bucket under `<country>/rt/`. It is kept apart from `backend/` (Spain) and
`backend-uk/`. Each country feed is its own Durable Object, with its own timer, back-off and
status.

## Ireland (docs/europe/ie.md)

The NTA's GTFS-Realtime v2 (`api.nationaltransport.ie/gtfsr/v2/`) covers every operator in
Ireland. The NTA allows **one call per 60 s per key**, for all its feeds together.

**Each cycle (every 61 s):**
- It fetches one feed: **TripUpdates**, except every fifth minute, which is **alerts** instead.
- It keeps Iarnród Éireann's entities, byte for byte, as published (`src/protobuf.js`,
  `src/gtfsrt.js`):
  - trip updates on Irish Rail's routes: names like `DUB-CORK-O`, where other operators use codes
    like `03C_120_e_a`. A trip without a route id is kept when it carries the same trip-id prefix
    as Irish Rail's trips;
  - alerts about the agency (`IR`), its routes or its trips.
- It writes:
  - `ie/rt/trip_updates.pb`;
  - `ie/rt/alerts.pb`;
  - `ie/rt/status.json`, in the same shape as Spain's and the UK's, so the app reads it with the
    same code.

**If a call fails** (HTTP 429, network), the next one waits 1, 2, 4… minutes, at most 30. The
status shows `failures`, `nextCallAt` and the error.

**The key** is the Worker secret `IE_NTA_API_KEY`, put by the deploy job from the GitHub secret of
the same name. It is sent only in the `x-api-key` header, never in a URL or the status. Use the
NTA's **primary** key; the secondary one is a spare for rotating it.

## Settings

- **`IE_ENABLED`** (wrangler var): the kill switch. The deploy job (`eu` in `deploy.yml`) sets it
  to `true` when the repository variable `IE_ENABLED` is `true` and the secret exists.
- **Redeploys:** a merge redeploys this Worker only when `backend-eu/` changed. Actions → Deploy →
  Run workflow always redeploys it.

## Tests

Run `node --test backend-eu/test/*.test.mjs`. The tests cover:
- the filters, on feeds built in the test;
- the one-call-a-minute schedule;
- the key sent only in a header;
- the back-off;
- running without a key.
