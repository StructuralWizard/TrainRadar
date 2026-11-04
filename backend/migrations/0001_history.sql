-- Delay history (phase C3). Read-only to the public API; written by the
-- recorder (finished runs) and the daily job (aggregates). No personal data.

-- One row per finished (or 3 h stale) run of a trip on a service day.
CREATE TABLE IF NOT EXISTS trips (
  service_date   TEXT NOT NULL,    -- YYYY-MM-DD (Madrid service day)
  trip_id        TEXT NOT NULL,    -- GTFS trip id
  train_no       TEXT NOT NULL,
  line           TEXT NOT NULL,    -- "10-C5" (núcleo-line) or "60000-71801" (terminal stop ids)
  product        TEXT NOT NULL,    -- "CERCANIAS", "AVE", "ALVIA", "MD"…
  origin_id      TEXT NOT NULL,
  dest_id        TEXT NOT NULL,
  sched_dep      INTEGER NOT NULL, -- unix seconds
  sched_arr      INTEGER NOT NULL,
  arr_delay_min  INTEGER,          -- at the last stop; NULL if not seen arriving
  max_delay_min  INTEGER,
  last_delay_min INTEGER,          -- last delay seen (when arrival is unknown)
  cancelled      INTEGER NOT NULL DEFAULT 0,
  stops_json     TEXT NOT NULL,    -- [[stop_id, sched_ts, delay_min|null, estimated 0/1], ...]
  source_quality TEXT NOT NULL,    -- 'renfe_tu' | 'gps_estimate'
  PRIMARY KEY (service_date, trip_id)
);
CREATE INDEX IF NOT EXISTS trips_train ON trips (train_no, service_date);

-- Daily punctuality per line and product (kept forever: small).
CREATE TABLE IF NOT EXISTS line_daily (
  service_date TEXT NOT NULL,
  line         TEXT NOT NULL,
  product      TEXT NOT NULL,
  trips        INTEGER NOT NULL,
  on_time      INTEGER NOT NULL,   -- known delay < 5 min
  late_5       INTEGER NOT NULL,   -- 5 min or more
  late_15      INTEGER NOT NULL,   -- 15 min or more
  cancelled    INTEGER NOT NULL,
  median_delay REAL,
  p90_delay    REAL,
  PRIMARY KEY (service_date, line, product)
);
CREATE INDEX IF NOT EXISTS line_daily_line ON line_daily (line, service_date);

-- Daily punctuality per station (arrivals with a known delay).
CREATE TABLE IF NOT EXISTS station_daily (
  service_date TEXT NOT NULL,
  stop_id      TEXT NOT NULL,
  calls        INTEGER NOT NULL,
  on_time      INTEGER NOT NULL,
  late_5       INTEGER NOT NULL,
  late_15      INTEGER NOT NULL,
  median_delay REAL,
  p90_delay    REAL,
  PRIMARY KEY (service_date, stop_id)
);
CREATE INDEX IF NOT EXISTS station_daily_stop ON station_daily (stop_id, service_date);
