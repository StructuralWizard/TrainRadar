-- TrainRadar cab-ride video database (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE videos (
  video_id          TEXT PRIMARY KEY,      -- YouTube id (11 chars)
  url               TEXT NOT NULL,
  title             TEXT NOT NULL,         -- real title, read from YouTube
  channel           TEXT NOT NULL,
  duration_s        INTEGER NOT NULL,      -- real length, read from YouTube
  country           TEXT NOT NULL,         -- ES | PT | GB | NI | IE | IM | FR | DE | CH
  category          TEXT NOT NULL,         -- ES: hsr | long_distance | regional | cercanias | cercanias_am | fgc | euskotren | sfm | funicular; UK/IE: intercity | regional | suburban | archive; both: freight | test_train | heritage | metro | tram | rack | foreign
  operator          TEXT,
  line_or_route     TEXT,
  origin            TEXT,
  destination       TEXT,
  view_type         TEXT,                  -- cab | front | passenger | trackside | mixed
  coverage          TEXT,                  -- full | partial | clip | compilation
  app_scope         TEXT NOT NULL,         -- core (national main-line network: Renfe/Adif in ES, National Rail in GB) | extended (metro, tram, heritage, other operators, NI/IE) | out (foreign / clip / not a ride)
  timestamp_quality TEXT NOT NULL,         -- precise | approximate | unverified | estimated | none
  stops_source      TEXT NOT NULL,         -- youtube_chapters | curated_sequence | gemini_sequence | research_doc_times | borrowed_sequence | route_endpoints | none
  n_stops           INTEGER NOT NULL,
  notes             TEXT,
  research_doc      TEXT,                  -- which Word document listed it
  research_section  TEXT,                  -- section of that document
  verified_on       TEXT                   -- date the video was confirmed to exist
);

CREATE TABLE video_stops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    TEXT NOT NULL REFERENCES videos(video_id),
  seq         INTEGER NOT NULL,            -- order along the ride
  name        TEXT NOT NULL,               -- display name as written
  station_key TEXT NOT NULL,               -- normalised key (lowercase, no accents; UK/IE metro & tram stops prefixed 'm:') -> stations.station_key
  point_type  TEXT NOT NULL,               -- station | waypoint (junction, tunnel, viaduct, gorge...)
  t_seconds   INTEGER,                     -- seconds into the video
  t_source    TEXT NOT NULL,               -- uploader_chapter | research_doc_unverified | even_spacing_estimate
  deep_link   TEXT NOT NULL,               -- youtube url with &t=
  UNIQUE (video_id, seq)
);
CREATE INDEX idx_stops_station ON video_stops(station_key);
CREATE INDEX idx_stops_video   ON video_stops(video_id);

CREATE TABLE stations (
  station_key   TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  name_variants TEXT,
  country       TEXT,
  n_videos      INTEGER,
  categories    TEXT,
  app_scope     TEXT,
  network_stop_id TEXT,                    -- TO FILL: Renfe GTFS stop_id (ES) / CP-IP code (PT) / CRS or NaPTAN code (GB) / NIR, IÉ codes
  lat           REAL,
  lon           REAL
);

-- Handy view: every video that shows a given station, best first
CREATE VIEW station_videos AS
SELECT s.station_key, st.display_name, v.country, v.video_id, v.title, v.channel, v.category, v.view_type,
       v.timestamp_quality, s.t_seconds, s.t_source, s.deep_link
FROM video_stops s
JOIN videos v ON v.video_id = s.video_id
JOIN stations st ON st.station_key = s.station_key
WHERE s.point_type = 'station' AND v.app_scope <> 'out'
ORDER BY s.station_key,
         CASE v.timestamp_quality WHEN 'precise' THEN 0 WHEN 'approximate' THEN 1 ELSE 2 END,
         CASE v.view_type WHEN 'cab' THEN 0 WHEN 'front' THEN 1 ELSE 2 END;
