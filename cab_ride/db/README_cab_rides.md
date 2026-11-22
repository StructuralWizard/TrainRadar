# TrainRadar: cab-ride video database (Spain, Portugal, UK, Ireland and the rest of Europe)

This package adds YouTube cab-ride videos to TrainRadar. In a station popup, the user sees the videos that pass that station, each with a link that opens at the right moment. In a train popup, the user sees the videos that cover the stretch the train is on, opened at about where the train is now.

## Sources and checks
| Research document | Unique videos | Exists on YouTube (checked 2026-11-21) |
|---|---|---|
| `Renfe Cab Ride Videos.docx` (Gemini chat) | 270 | 270 |
| `UK Train Cab Videos & Timestamps.docx` (Gemini chat) | 349 (1 also appears in the Spanish doc) | 349 (2 are members-only, so they're marked `out`) |
| `Portuguese Train Cab Ride Videos.docx` (Gemini chat) | 49 (3 also appear in the Spanish doc) | 49 |
| `spanish_train_cab_rides.csv` (Gemini's CSV export) | 121 | All 121 are already in the Spanish doc, so it adds nothing |

**Every video ID from the Spanish, UK and Portuguese documents is in the database. None were dropped.**

### Rest of Europe (added 2026-11-21)
- **YouTube search:** about 90 searches in the local languages across 31 countries, for videos over 20 minutes. This found **1,589 videos**.
- **Gemini documents for Belgium, the Netherlands and Luxembourg** (added later on 2026-11-21): 308 new videos, all read on YouTube; 305 exist.
- **Gemini documents for Germany and Italy** (added later on 2026-11-21): 499 new videos, all read on YouTube; 497 exist.
- **Gemini documents for Denmark, Norway, Poland and Sweden** (added later on 2026-11-21): 327 videos, all read on YouTube in full; 323 play and 4 are unavailable (`UNPLAYABLE`). New: DK 89, NO 64, PL 59, SE 111. 119 of them have the uploader's own chapter timestamps.
- **Gemini documents for 21 more countries** (added 2026-11-22: Albania, Austria, Belarus, Bosnia, Bulgaria, Croatia, Czechia, Estonia, Finland, Greece, Hungary, Latvia, Lithuania, Moldova, Montenegro, Romania, Serbia, Slovakia, Slovenia, Türkiye, Ukraine): 1,311 unique videos, 1,151 of them new. All 1,300 that needed it were read on YouTube in full (149 of these were already in the database from search results and now have chapters too): 1,283 play, 9 are unavailable and 8 IDs don't exist. New country codes: `BY` (Belarus), `TR` (Türkiye), `XK` (Kosovo). A short ride (2–6½ min) is now kept as `partial` rather than hidden as a clip when its title names a cab ride between two places.
- **Gap filling** (2026-11-22): targeted YouTube searches for the networks and countries that had no video (city metros and trams, Alpine and narrow-gauge lines, Kosovo, North Macedonia, Liechtenstein, Monaco and others). 291 search results were read; only clear front/cab rides are kept (guides, news, station tours and escalator vlogs are marked `out`); 31 more were hand-checked. Notes say `from targeted gap search`. All 909 videos that had only search-result metadata were also read in full, so every video now has its real length and chapter list. New country code `LI` (Liechtenstein, the Feldkirch–Buchs line).
- **Coverage gaps:** `GAPS_table.md` lists, per country, the notable networks with no video in the database (made by `source/gaps.py`).
- **Gemini documents for France, Switzerland and Ireland:** 116 videos. 112 are new; 107 exist on YouTube and 4 return "not found" from YouTube's oEmbed lookup (`AoMWOguBnb8`, `mWV09lMNFBU`, `gm1i9p4mjew`, `pOBWdCu-qws`).
- **How much was read in full:** 522 videos were read on YouTube in full (length, chapters, keywords). Then YouTube's rate limit stopped the job. All search results have since been read in full (see Gap filling below). The 107 Gemini videos have title and channel only (from oEmbed), so their length is unknown. `notes` says which applies to each video, and `source/europe/pending.json` lists the IDs still to read.
- **Classification:** done automatically from the title and keywords (`notes` contains "auto-classified"):
  - `country` comes from flag emoji, operator names and place names, falling back to the country searched for.
  - Category comes from keywords (tram, metro, rack railway, heritage, freight, high-speed, suburban).
  - `app_scope='out'` marks spotting, vlogs, documentaries, simulators and short clips.
  - Expect a few misclassifications. That includes the IDs that appeared only in Gemini's "Sources" lists. Videos that are clips, trackside footage, news items, previews or foreign rides are kept but marked `app_scope='out'`, so the app can hide them.

The title, channel and real duration were read from YouTube. Station timestamps were taken from the uploader's own chapter list in each video's description. Gemini's durations and most of its timestamps were thrown away because they were unreliable.

## Files
| File | What it is |
|---|---|
| `cab_rides.db` | SQLite database: tables `videos`, `video_stops`, `stations`, and view `station_videos`. All countries are in it. |
| `videos.csv`, `video_stops.csv`, `stations.csv` | The same three tables as CSV |
| `cab_rides.json` | Bundle for the app: **Spain**. 169 rides, about 38 kB gzipped. |
| `cab_rides_pt.json` | Bundle for the app: **Portugal**. 44 rides, about 14 kB gzipped. |
| `cab_rides_europe.json` | Bundle for the app: **31 other European countries**, each video tagged with its country. 1,381 rides, about 348 kB gzipped. |
| `cab_rides_uk_ie.json` | Bundle for the app: **Great Britain, Northern Ireland, Ireland and the Isle of Man**. 253 rides, about 59 kB gzipped. Use it for the planned UK map. |
| `schema.sql` | The database schema, with a comment on every column |
| `source/` | The scripts and verified YouTube data used to rebuild everything: `python build_all.py <es_dir> <uk_dir> <pt_dir> <europe_dir> <out_dir>`. On your PC that is `source source/uk source/pt source/europe <out>`. |

## Counts
| Country | core | extended | out |
|---|---|---|---|
| ES | 109 | 88 | 70 |
| PT | 42 | 8 | 13 |
| Rest of Europe (36 countries) | 3,066 | 566 | 640 |

Videos per country (rest of Europe, excluding `out`): DE 527, IT 295, CH 234, NL 212, AT 197, FR 196, HU 154, SE 153, BE 126, NO 125, SK 124, PL 105, GR 105, DK 104, FI 98, BG 88, TR 87, SI 77, UA 71, CZ 71, HR 69, RS 61, IE 59, RO 57, BY 41, LU 30, LV 25, EE 25, BA 25, MK 23, LT 16, AL 16, MD 12, ME 11, XK 9, LI 4.
| GB | 173 | 77 | 50 |
| IE / NI / IM | – | 13 / 8 / 2 | 8 / 1 / – |
| FR / DE / CH | – | – | 8 / 3 / 5 |

`core` means the national main-line network: Renfe/Adif in Spain, CP/IP in Portugal, National Rail in Great Britain. This includes Elizabeth line, Overground, Merseyrail, freight, test trains and BR archive footage on Network Rail lines. `extended` covers metro, tram, the Underground, heritage, rack and miniature railways, other Spanish operators, Northern Ireland and Ireland.

How reliable the timestamps are (rides not marked `out`):

| | precise | approximate | estimated | none |
|---|---|---|---|---|
| ES | 21 | 13 | 134 | 29 |
| PT | 28 | 0 | 18 | 4 |
| Rest of Europe | 1356 | 55 | 1200 | 962 |
| UK / IE | 85 | 0 | 191 | 43 |

## Data model
**videos** has one row per YouTube video.
- `country`: ISO 3166 code (`ES`, `PT`, `GB`, `NI`, `IE`, `IM`, `FR`, `DE`, `CH`, … 41 in all; `XK` is Kosovo). The three Portuguese rides from the Spanish doc (Porto–Valença, Valença–Porto and Entroncamento–Badajoz) have been moved to `PT`.
- `category`: in Spain `hsr`, `long_distance`, `regional`, `cercanias`, `cercanias_am`, `fgc`, `euskotren`, `sfm`, `funicular`. In Portugal, the UK and Ireland `intercity`, `regional`, `suburban`, `archive`. Used in both: `freight`, `test_train`, `heritage`, `metro`, `tram`, `rack`, `foreign`.
- `view_type`: `cab`, `front`, `passenger`, `trackside` or `mixed`. `coverage`: `full`, `partial`, `clip` or `compilation`.
- `timestamp_quality`:
  - `precise`: the uploader's chapters mark each station.
  - `approximate`: the chapters are rounded or sparse, or a stop list is pinned by a few chapter anchors.
  - `estimated`: we know the order of stops but not the times, so times are spaced evenly.
  - `none`: no stops.
- `stops_source`: where the stop list came from.
  - `youtube_chapters`: the uploader's chapters.
  - `curated_sequence`: stop names from the research doc's route descriptions or from rail-network knowledge.
  - `gemini_sequence`: a stop list parsed automatically from the research doc.
  - `borrowed_sequence`: taken from another video that covers the same stretch.
  - `route_endpoints`: just the first and last station.
- `research_doc` and `research_section`: where the video was listed in the research documents.

**video_stops** lists the stops of each video in order (`seq`).
- `point_type` is `station` or `waypoint` (junction, tunnel, viaduct, summit).
- `t_seconds` is the number of seconds into the video.
- `t_source` is `uploader_chapter` or `even_spacing_estimate`.
- `deep_link` is the YouTube URL with `&t=`.
- `station_key` is the name in lowercase, without accents or punctuation. **Metro and tram stops outside Spain have the prefix `m:`**, so Underground "Stratford" doesn't merge with National Rail "Stratford", and Lisbon tram "Santos" doesn't merge with the CP station "Santos".

**stations** has one row per station key and country (2,626 rows, 400 of them in Portugal). `network_stop_id`, `lat` and `lon` are **empty and need to be filled** (task 1).

JSON bundle layout (both files):
```json
{"videos":[{"id":"o8jJmEdPRL8","title":"…","ch":"250renfe","dur":6424,"country":"ES","cat":"cercanias",
  "op":"Rodalies de Catalunya","route":"R11","view":"cab","cov":"full","scope":"core","q":"precise",
  "stops":[["portbou","Portbou",13,1,1], …]}],     // [station_key, name, t_seconds, is_station, t_is_real]
 "stations":{"portbou":"Portbou", …}}
```

## Integration tasks for Claude Code

### 1. Match stations to network stops (do this once, offline)
- **Spain:** normalise Renfe GTFS `stops.txt` names the same way the database does: lowercase, strip accents, turn non-alphanumerics into spaces, drop `estación de`. Then match on `station_key`. If there is no exact match, use fuzzy matching (token set ratio ≥ 90), and limit candidates to stops near the video's other matched stops.
- **Portugal:** match against the CP or IP station list in the same way. Many Lisbon suburban stations appear in 5–8 videos.
- **Great Britain:** match against the National Rail station list, by CRS code or NaPTAN, using the station name. For `m:` keys, use the TfL, Metrolink and Nexus stop lists.
- Write the results to `stations.network_stop_id`, `lat` and `lon`. Also write them to a reviewed `station_aliases.json` so the mapping is stable.
- Some names are deliberately loose and need a manual decision: generic freight endpoints such as `Barcelona` or `Madrid`, and waypoints such as `W:Toton Yard`.

### 2. Re-estimate the `estimated` timestamps (needs step 1)
For every video, take the stops that have a real time (`t_source='uploader_chapter'`) as anchors. The first and last stop are also anchors, at about 2% in from each end. Between two anchors, give each stop a time in proportion to its **cumulative distance along the line**, not its index. Write the result back with `t_source='distance_estimate'`.

### 3. Station popup
- Query: `SELECT * FROM station_videos WHERE station_key = ? AND country = ?`, or use the JSON bundle for the active country.
- Show `core` first, then `extended`. Within each, sort by `q` (precise, then approximate, then estimated), then `view` (cab, then front, then passenger). Show at most 3, then a "ver más" link.
- Show each video as a compact row:
  - a thumbnail from `https://i.ytimg.com/vi/{id}/mqdefault.jpg`;
  - the title, cut short;
  - the channel;
  - a "▶ 41:10" chip;
  - a `≈` before the time when `t_is_real=0`.
- On tap, open `https://www.youtube.com/watch?v={id}&t={t}s`. On Android, use an intent so the YouTube app opens. On the web, you can embed `https://www.youtube-nocookie.com/embed/{id}?start={t}`.

### 4. Train popup
- Use the train's previous stop A, next stop B, and progress fraction `f` between them.
- Find the videos where A and B both appear, in either order, with no more than about 3 stops between them. For a reversed video, swap the times.
- Video time = `t_A + f × (t_B − t_A)`. Show it with "≈". Rank as in the station popup, but prefer videos filmed in the same direction as the train.
- If nothing matches, fall back to videos that contain A or B.

### 5. Packaging
- Load the bundle for the active country lazily, the first time a popup opens. No backend is needed, just links.
- The SQLite file is the master copy for editing. Generate the JSON bundles from it with a script so they never drift apart.
- Add an "Aportar vídeo" / "Suggest a video" link so users can propose new rides.

## Known caveats
- **Rest of Europe:** most rides have only the endpoints parsed from the title (`route_endpoints`), or no stops (`none`). Running the enrichment over `pending.json`, slowly (one request every few seconds), will add chapters to many of them. The country and category were set automatically, so check them before showing a country's videos in the app.
- Station names in `curated_sequence`, `gemini_sequence` and `borrowed_sequence` rides are **not checked against the footage**. A few intermediate stops may be skipped or in the wrong order. Real chapter anchors are reliable.
- Freight rides follow freight routes. Their station lists are a loose guide, and many freight endpoints are yards or junctions, stored as waypoints.
- A few uploader chapters are wrong. For example, `FO4_cy6fnsQ` has a chapter after the end of the video. Those times were dropped and re-estimated.
- Videos can be deleted or made private. Re-check periodically with oEmbed (`https://www.youtube.com/oembed?url=…`, which returns 404 or 401 when a video is gone) and hide dead ones.
