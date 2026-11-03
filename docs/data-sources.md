# Data sources

Status: **verified on 2026-11-01 and approved by the maintainer on 2026-11-01**, including the
unlisted `trip_updates_LD` feed and the CORS pass-through Worker. Facts below come from the
"Feed check" GitHub Actions run (`tools/feed-check`): headless Chromium on a separate HTTPS
origin, plus the official dataset metadata from the data.renfe.com CKAN API
(`/api/3/action/package_show`). Re-run the workflow any time to refresh them.

## Realtime feeds (polled by the browser)

All GTFS-Realtime v2.0, on `https://gtfsrt.renfe.com`, each published as protobuf (`.pb`) and
JSON (`.json`). We will use **`.pb`**: 4–5× smaller than the JSON.

| Feed | Dataset (data.renfe.com) | URL | `.pb` size | `.json` size | Official refresh | Measured change gap |
|---|---|---|---:|---:|---|---|
| Vehicle positions, Cercanías | `ubicacion-vehiculos` | `/vehicle_positions.pb` | 23.4 KB | 104.9 KB | 20 s | ~21–25 s |
| Vehicle positions, AV/LD/MD | `posicion-vehiculos-av-ld-md` | `/vehicle_positions_LD.pb` | 8.8 KB | 44.6 KB | 15 s | ~17 s |
| Trip updates, Cercanías | `horarios-viaje-cercanias` | `/trip_updates.pb` | 20.0 KB | 114.0 KB | 20 s | ~18–21 s |
| Trip updates, AV/LD/MD | not listed in CKAN (see note) | `/trip_updates_LD.pb` | 11.4 KB | 50.3 KB | — | ~15 s |
| Alerts, Cercanías | `incidencias-avisos` | `/alerts.pb` | 41.8 KB | 97.4 KB | 20 s | no change in 3 min |

All responses: HTTP 200, `Cache-Control: max-age=30, public`, `Last-Modified` set.

**Planned polling:** 30 s per feed (the server's own `max-age`), ±3 s jitter, exponential
backoff on errors, paused while the tab is hidden. Total ≈ 105 KB per 30 s with all feeds;
Cercanías feeds will only be polled when a Cercanías region is on screen.

### CORS and HTTPS

| Check | Result |
|---|---|
| HTTPS | ✅ all endpoints |
| Plain HTTP | ❌ connection times out (so no mixed-content issue; HTTPS only) |
| `Access-Control-Allow-Origin` | ❌ **absent on every endpoint** |
| Browser `fetch()` from another origin | ❌ blocked: "No 'Access-Control-Allow-Origin' header is present" |

**Conclusion:** direct browser access is impossible. We need the minimal Cloudflare Worker
described in the hard constraints: forward the raw bytes **unchanged**, add CORS headers,
edge-cache for at most 15 s (the shortest refresh interval), allow-list only the five paths
above, no parsing or logic.

### Notes and quirks

- `trip_updates_LD` is live and valid but not listed as a resource in any CKAN dataset we
  queried. It sits on the same host and comes from the same CC BY 4.0 publisher, so we treat
  it as part of the same open-data service (maintainer decision, 2026-11-01).
- **Alerts feed is stale:** `Last-Modified: Wed, 07 Oct 2026` (≈25 days old at check time).
  Other projects report it stalling for weeks. The UI must show the feed's age and hide
  incidents older than a threshold.
- Third parties report the AV/LD/MD GTFS-RT header `timestamp` is an hour off; we will trust
  per-entity timestamps and `Last-Modified` and verify in phase A3.
- Cercanías vehicle `label` carries the platform, e.g. `"C1-23537-PLATF.(3)"` (official note).

## Static timetables (downloaded in CI only, never by the browser)

| Dataset | URL | Size | Updated |
|---|---|---:|---|
| `horarios-de-alta-velocidad-larga-distancia-y-media-distancia` | `https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip` | 836 KB | daily (Last-Modified 2026-11-01 00:04 GMT) |
| `horarios-cercanias` | `https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip` | 16.1 MB | daily (2026-11-01 03:08 GMT) |
| `estaciones-listado-completo` | `https://ssl.renfe.com/ftransit/Fichero_estaciones/estaciones.csv` (+ `.xlsx`) | 139 KB | 2026-11-01 01:50 GMT |

All three send an `ETag`, so the nightly CI job can skip the rebuild when nothing changed.
Structure (from `refdata-build inspect`, 2026-11-01):
- AV/LD/MD: 672 routes, 1,006 stops, 8,532 trips, `calendar.txt` + `calendar_dates.txt`,
  **no `shapes.txt`**. Times aren't zero-padded (`8:30:00`).
- Cercanías: 265 routes (48 are buses), 1,147 stops, 138,503 trips (one service id per
  day), `shapes.txt` with one shape per line, 288 MB `stop_times.txt`. `route_id` starts
  with the núcleo code (`10T0001C1` → 10 Madrid).
Reported quirks: fields padded with spaces; the stations CSV is Latin-1.

## Licence and attribution

Every dataset above is published by Renfe Operadora under **Creative Commons Attribution 4.0
(CC-BY-4.0)** per the CKAN metadata. CC BY 4.0 permits redistribution and derived works,
including in an open-source app, provided we credit the source, link the licence and say that
we changed the data.

Attribution used in the UI and README:

> Datos: © Renfe Operadora, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
> ([data.renfe.com](https://data.renfe.com)). Procesados y combinados por TrainRadar.

Still to do: read the portal's legal page (`data.renfe.com/legal`) for any extra conditions;
this sandbox couldn't reach it.

## OpenStreetMap (track geometry, built in CI)

| What | URL | Licence |
|---|---|---|
| Spain extract | `https://download.geofabrik.de/europe/spain-latest.osm.pbf` | ODbL 1.0 |
| Portugal extract (cross-border trains) | `https://download.geofabrik.de/europe/portugal-latest.osm.pbf` | ODbL 1.0 |

Downloaded at most weekly (GitHub Actions cache), filtered to `railway=rail`.
Attribution: "© OpenStreetMap contributors". Approved by the maintainer on
2026-11-01.

## Copernicus DEM (track heights, built in CI)

| What | Where | Licence |
|---|---|---|
| Copernicus DEM GLO-30, 1°×1° COG tiles | `https://copernicus-dem-30m.s3.amazonaws.com/` (AWS Open Data, no key) | Copernicus WorldDEM-30 licence, free for the general public |

- Only the tiles with rail in them are downloaded, in CI, at most weekly. Only
  heights under rail nodes are kept, as height profiles of the track legs.
- Required notice for modified data, shown in the README and in the popup:
  *"produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus
  Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European
  Union and ESA; all rights reserved"*, plus the disclaimer *"The organisations
  in charge of the Copernicus programme by law or by delegation do not incur
  any liability for any use of the Copernicus WorldDEM-30."*
- Licence PDF: [License-COPDEM-30](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf).
  This session couldn't open it; the wording above comes from the dataset's
  catalogue pages and should be checked against the PDF.

## OUIGO timetable (NAP, approved 2026-11-02)

| What | Where | Notes |
|---|---|---|
| OUIGO GTFS (UIC MERITS export) | NAP dataset [1515](https://nap.transportes.gob.es/ConjuntoDato/Detail/1515), file 1766, via `GET /api/Fichero/download/1766` with header `ApiKey` | 11 routes, ~70 trips, valid to 12 Dec 2026; file dated 2 Jul 2026 |

- Downloaded in CI only, with the `NAP_API_KEY` GitHub secret (never in the browser).
- Station codes are UIC (`007160000`); the last five digits are Adif's, so
  they match Renfe's stations. No shapes: OSM routing is used.
- OUIGO publishes **no live data**, so its trains are shown **by timetable**
  (hollow purple arrows) and labelled as such, with a link to OUIGO.
- **Licence** ([NAP licence](https://nap.transportes.gob.es/licencia-datos), MITRAMS open-data
  licence under Ley 37/2007): commercial and non-commercial reuse, copying,
  modification and combination allowed; derived works may use other licences.
  Obligations we meet: cite MITRAMS as source and say the data is *explotado*
  (processed); show **"Powered by MITRAMS"** with a link to
  https://www.transportes.gob.es/; keep the update date (shown in each OUIGO
  popup); keep it up to date (rebuilt nightly); no suggestion that MITRAMS
  endorses TrainRadar.

## IDEAdif (Adif's geoportal)

- Licence (IDEE catalogue record): *"Se permite cualquier uso si se menciona la
  autoría de ADIF del siguiente modo: «© Administrador de infraestructuras
  ferroviarias»"*.
- Services: `https://ideadif.adif.es/services/wfs` and `/services/wms`. On
  2026-11-02 both returned **HTTP 503** to GitHub's servers, so nothing is
  integrated yet. Next step: a manual download from IDEAdif, or a retry later.
- 2026-11-03: still **HTTP 503** (an Akamai error page) from this project's
  cloud sandbox too, while idee.es itself answers: the IDEAdif server is down
  or refuses outside clients, not a network setting on our side.
- The same WFS is catalogued on idee.es ("WFS de la Red de Transporte
  Ferroviario de Adif") and on datos.gob.es, where the licence is given as
  **CC BY 4.0**. The RFIG (Red Ferroviaria de Interés General) is the network
  Adif manages, so this WFS is the RFIG source. The idee.es record points to
  the IDEAdif download centre for files.

## IGN transport network, IGR-RT (used from 2026-11-03)

"Redes de Transporte de España" (IDEE record `spaign_IGR_Transporte`, metadata
of 11 Sep 2026): the national reference transport network by the IGN, INSPIRE
Transport Networks model, version of July 2026. Its rail network is built from
**ADIF** data (plus BTN25/BTN100 and TEN-T), so it covers the RFIG.

| What | Where | Licence |
|---|---|---|
| Railway links (60,018; 38,256 with attributes) | `https://api-features.idee.es/collections/railwaylink` (OGC API Features, no key) | **CC BY 4.0** ("IGR-RT 2026 CC-BY 4.0 scne.es"), no access or use conditions |

- **Used:** number of tracks and electrification, matched onto our OSM legs
  in CI (`tools/fetch-igr-rail.py`, `refdata-build build --rail-attrs`) and shown
  in the popup ("vía única · sin electrificar"). Attribution: "© Instituto
  Geográfico Nacional (SCNE, IGR-RT), CC BY 4.0", in the README and map credits.
- **Not used:** heights. The links are 3D, but the heights follow the terrain:
  the Guadarrama base tunnel goes up to 2,166 m over the mountain, and some
  points are 0. Copernicus with OSM tunnels/bridges stays the height source.
- **Not available:** design speed and line names (`railwayLineCode` and
  `geographicalName` are empty). The WFS (`servicios.idee.es/wfs-inspire/transportes`)
  also has `tn:VerticalPosition` and `tn:ConditionOfFacility`, but for every
  network (~10 million features), so it isn't worth paging through.
- The CNIG download centre (`centrodedescargas.cnig.es`) dropped our
  connections on 2026-11-03; the API is enough.

## Adif network status (researched 2026-11-01)

Adif (the infrastructure manager) publishes network status, including incidents
affecting all operators (Renfe, Iryo, Ouigo), only as a web page:
[adif.es → Estado de la red](https://www.adif.es/viajeros/estado-de-la-red).

- **No official feed.** There's no RSS, API or GTFS-RT/SIRI feed for it. Nothing
  for Adif on data.renfe.com, datos.gob.es or the NAP. Adif's only open data
  there is static infrastructure (the rail network as WFS).
- **Terms.** Adif's [legal notice](https://www.adif.es/aviso-legal) reserves all
  rights to the site's content, databases and texts and prohibits reproduction or
  distribution without Adif's authorisation. Other projects report that the site
  returns 403 to automated clients, and that the Adif app uses undocumented,
  signed requests.
- **Decision:** TrainRadar does **not** scrape Adif. The notices panel links to
  Adif's page instead. Showing Adif's data would need either a published feed or
  written authorisation (a re-use request under Ley 37/2007).

## Renfe notices feed status

`alerts.pb` decodes fine, but on 2026-11-01 its `Last-Modified` was
**7 Oct 2026**. All 69 notices had no end date, so all count as "active", and
several describe works that have finished. The app shows the feed's age and
each notice's start date, and warns when the feed is more than 2 days old.

## Not used (yet)

- NAP (nap.transportes.gob.es) mirrors the same GTFS but needs an API key, so it isn't
  suitable for a keyless browser app. Not needed.
- Adif network status: researched in phase A6.
