# Data sources

Status: **candidates, pending confirmation.** Nothing below is used by the app until it has
been checked by `tools/feed-check` (see the "Feed check" GitHub Actions run) and approved.

## Realtime (fetched by the browser)

All on `https://gtfsrt.renfe.com`. GTFS-Realtime v2.0, each in protobuf (`.pb`) and JSON
(`.json`) forms.

| Feed | Dataset on data.renfe.com | Candidate URL |
|---|---|---|
| Vehicle positions, Cercanías | `ubicacion-vehiculos` | `/vehicle_positions.pb` · `.json` |
| Vehicle positions, AV/LD/MD | `posicion-vehiculos-av-ld-md` | `/vehicle_positions_LD.json` (`.pb` to verify) |
| Trip updates, Cercanías | `horarios-viaje-cercanias` | `/trip_updates.pb` · `.json` |
| Trip updates, AV/LD/MD | (to confirm) | `/trip_updates_LD.json` (`.pb` to verify) |
| Alerts / incidents, Cercanías | `incidencias-avisos` | `/alerts.pb` · `.json` |

Refresh: reported as ~20–30 s by third parties. To be measured by feed-check; polling
intervals will come from measured values, not from this table.

Known quirks (reported by other projects, to verify):
- The AV/LD/MD feed header `timestamp` is reportedly an hour off; HTTP `Last-Modified` is
  more reliable.
- The alerts feed has reportedly stalled for weeks at a time.
- At least one project reports the feeds **don't allow CORS**. If confirmed, a pass-through
  Cloudflare Worker is needed.

## Static timetables (fetched in CI only)

| Dataset | Candidate URL |
|---|---|
| `horarios-de-alta-velocidad-larga-distancia-y-media-distancia` | `https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip` |
| `horarios-cercanias` | `https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip` |
| `estaciones-listado-completo` | `https://ssl.renfe.com/ftransit/Fichero_estaciones/estaciones.csv` |

Known quirks: fields padded with spaces; stations CSV in Latin-1; Cercanías `stop_times.txt`
reportedly ~300 MB uncompressed.

## Licence and attribution

Renfe's datasets are listed as **CC BY 4.0** (per datos.gob.es and the portal's dataset
listings; the legal page `data.renfe.com/legal` still needs to be read). CC BY 4.0 allows
redistribution and derived works, including in an open-source app, with attribution.

Planned attribution (UI and README): "Datos: © Renfe Operadora, CC BY 4.0
(data.renfe.com). Modificados: procesados y combinados por TrainRadar."
