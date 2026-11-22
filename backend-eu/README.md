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

## France (docs/europe/fr.md)

SNCF's open GTFS-Realtime, through transport.data.gouv.fr's proxy: no key, ODbL. SNCF refreshes
it every two minutes.

**Each cycle (every 30 s)** fetches one feed, alternating, so each is read once a minute:
- `sncf-gtfs-rt-trip-updates` → `fr/rt/trip_updates.pb`;
- `sncf-gtfs-rt-service-alerts` → `fr/rt/alerts.pb`.

Nothing is filtered: both feeds hold SNCF's trains only. `fr/rt/status.json` has the same shape as
Ireland's. The back-off is the same.

## Finland, Norway and the Netherlands (M2)

Open GTFS-Realtime, no key. Each provider asks clients to name themselves; we send a generic name
(`Metranos-TrainRadar`), never a person's details.

| Country | Source | Every cycle | Kept |
|---|---|---|---|
| Finland (`fi/rt/`) | Digitraffic (`Digitraffic-User` header) | 15 s: GPS and trip updates, alternating | everything (VR only) |
| Norway (`no/rt/`) | Entur (`ET-Client-Name` header) | 20 s: GPS; trip updates each minute; alerts every 5 min | Vy, Go-Ahead Nordic, SJ Norge, Flytoget (codespaces VYG, GOA, SJN, FLT) |
| Netherlands (`nl/rt/`) | OVapi `trainUpdates.pb` | 60 s | everything (trains only) |

Entur's trip updates are about 5 MB; filtering them takes about 50 ms.

## Settings

- **Which country an object serves:** its name (`ie`, `fr`), passed by the minute cron's
  `/ensure?c=<code>`. The object created before France existed is Ireland's.
- **`IE_ENABLED`** (wrangler var): Ireland's kill switch. The deploy job (`eu` in `deploy.yml`)
  sets it to `true` when the repository variable `IE_ENABLED` is `true` and the secret exists.
- **`FR_ENABLED`**, **`FI_ENABLED`**, **`NO_ENABLED`**, **`NL_ENABLED`** (wrangler vars): each
  country's switch, set from the repository variable of the same name.
- **Redeploys:** a merge redeploys this Worker only when `backend-eu/` changed. Actions → Deploy →
  Run workflow always redeploys it.

## Tests

Run `node --test backend-eu/test/*.test.mjs`. The tests cover:
- the filters, on feeds built in the test;
- the one-call-a-minute schedule, and France's alternating one;
- which countries the minute cron re-arms;
- the key sent only in a header;
- the back-off;
- running without a key.
