//! Reference-data `.bin` files built by `refdata-build` and read by the engine.
//!
//! Everything is postcard-encoded. Postcard writes integers as varints, so we
//! store coordinates as integer 1e-5 degrees (~1.1 m) and delta-encode
//! sequences: most deltas fit in one or two bytes.
//!
//! Timetables are limited to a short window of service days (yesterday plus
//! the next week) because the files are rebuilt daily. Trips that share the
//! same stops and relative times share one [`PatternRec`].

use crate::geo::{Polyline, haversine_m};
use crate::{FORMAT_VERSION, LatLon};
use serde::{Deserialize, Serialize};

/// First bytes of every `.bin` file.
pub const MAGIC: [u8; 4] = *b"TRRD";

/// Degrees → integer 1e-5 degrees.
pub fn to_e5(deg: f64) -> i32 {
    (deg * 1e5).round() as i32
}

pub fn from_e5(v: i32) -> f64 {
    f64::from(v) / 1e5
}

/// Common header. `window_start_day` is days since 1970-01-01 (service date).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Header {
    pub magic: [u8; 4],
    pub version: u16,
    pub window_start_day: u32,
    pub window_days: u8,
    /// Unix seconds when the file was built.
    pub generated_at: i64,
}

impl Header {
    pub fn new(window_start_day: u32, window_days: u8, generated_at: i64) -> Self {
        Self {
            magic: MAGIC,
            version: FORMAT_VERSION,
            window_start_day,
            window_days,
            generated_at,
        }
    }

    /// Reject files from another format version before trusting the rest.
    pub fn check(&self) -> Result<(), FormatError> {
        if self.magic != MAGIC {
            return Err(FormatError::BadMagic);
        }
        if self.version != FORMAT_VERSION {
            return Err(FormatError::Version(self.version));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormatError {
    BadMagic,
    Version(u16),
    Decode(String),
}

impl std::fmt::Display for FormatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadMagic => write!(f, "not a TrainRadar refdata file"),
            Self::Version(v) => write!(f, "refdata format v{v}, expected v{FORMAT_VERSION}"),
            Self::Decode(e) => write!(f, "decode error: {e}"),
        }
    }
}

impl std::error::Error for FormatError {}

/// Decode a file and check its header.
pub fn decode_file<T: for<'a> Deserialize<'a> + HasHeader>(bytes: &[u8]) -> Result<T, FormatError> {
    let v: T = postcard::from_bytes(bytes).map_err(|e| FormatError::Decode(e.to_string()))?;
    v.header().check()?;
    Ok(v)
}

pub trait HasHeader {
    fn header(&self) -> &Header;
}

// ---------------------------------------------------------------- stations

/// Service flags on a station.
pub const SERVICE_LONG_DISTANCE: u8 = 1;
pub const SERVICE_COMMUTER: u8 = 2;

/// All stations nationwide, loaded up front (small), with a spatial index.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StationsFile {
    pub header: Header,
    pub regions: Vec<RegionRec>,
    /// Sorted by grid cell; [`GridIndex`] points into this list.
    pub stations: Vec<StationRec>,
    pub grid: GridIndex,
}

impl HasHeader for StationsFile {
    fn header(&self) -> &Header {
        &self.header
    }
}

/// A timetable region: `"ld"` for AV/LD/MD, or a Cercanías núcleo code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegionRec {
    pub code: String,
    pub name: String,
    /// min lat, min lon, max lat, max lon in 1e-5 degrees.
    pub bbox_e5: [i32; 4],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StationRec {
    pub id: String,
    pub name: String,
    pub lat_e5: i32,
    pub lon_e5: i32,
    /// Bitwise OR of `SERVICE_*`.
    pub services: u8,
    /// Indexes into [`StationsFile::regions`] whose timetables serve this station.
    pub regions: Vec<u16>,
}

impl StationRec {
    pub fn coord(&self) -> LatLon {
        LatLon::new(from_e5(self.lat_e5), from_e5(self.lon_e5))
    }
}

/// Uniform lat/lon grid over the stations. Items are sorted by cell key
/// (`row << 16 | col`); `cells` lists each non-empty cell and its first item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridIndex {
    pub cell_e5: i32,
    pub origin_lat_e5: i32,
    pub origin_lon_e5: i32,
    pub cells: Vec<GridCell>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridCell {
    pub key: u32,
    pub start: u32,
}

impl GridIndex {
    /// Default cell: 0.1° (~11 km north–south, ~8.5 km east–west in Spain).
    pub const DEFAULT_CELL_E5: i32 = 10_000;

    /// Sort `items` in place by cell and build the index.
    pub fn build<T>(items: &mut [T], coord_e5: impl Fn(&T) -> (i32, i32), cell_e5: i32) -> Self {
        let origin_lat_e5 = items.iter().map(|t| coord_e5(t).0).min().unwrap_or(0);
        let origin_lon_e5 = items.iter().map(|t| coord_e5(t).1).min().unwrap_or(0);
        let mut grid = Self {
            cell_e5,
            origin_lat_e5,
            origin_lon_e5,
            cells: Vec::new(),
        };
        items.sort_by_key(|t| {
            let (la, lo) = coord_e5(t);
            grid.key_of(la, lo)
        });
        for (i, t) in items.iter().enumerate() {
            let (la, lo) = coord_e5(t);
            let key = grid.key_of(la, lo);
            if grid.cells.last().is_none_or(|c| c.key != key) {
                grid.cells.push(GridCell {
                    key,
                    start: i as u32,
                });
            }
        }
        grid
    }

    fn row_col(&self, lat_e5: i32, lon_e5: i32) -> (i64, i64) {
        (
            i64::from(lat_e5 - self.origin_lat_e5).div_euclid(i64::from(self.cell_e5)),
            i64::from(lon_e5 - self.origin_lon_e5).div_euclid(i64::from(self.cell_e5)),
        )
    }

    fn key_of(&self, lat_e5: i32, lon_e5: i32) -> u32 {
        let (r, c) = self.row_col(lat_e5, lon_e5);
        ((r.clamp(0, 0xFFFF) as u32) << 16) | c.clamp(0, 0xFFFF) as u32
    }

    /// Item range for one cell, given the total item count.
    fn range(&self, row: i64, col: i64, total: usize) -> Option<std::ops::Range<usize>> {
        if !(0..=0xFFFF).contains(&row) || !(0..=0xFFFF).contains(&col) {
            return None;
        }
        let key = ((row as u32) << 16) | col as u32;
        let i = self.cells.binary_search_by_key(&key, |c| c.key).ok()?;
        let end = self.cells.get(i + 1).map_or(total, |c| c.start as usize);
        Some(self.cells[i].start as usize..end)
    }

    /// The `k` nearest items within `max_m` metres, nearest first, as
    /// `(index, distance_m)`. Searches rings of cells outwards and stops once
    /// no unsearched cell can be closer than the k-th best hit.
    pub fn nearest<T>(
        &self,
        items: &[T],
        coord: impl Fn(&T) -> LatLon,
        p: LatLon,
        k: usize,
        max_m: f64,
    ) -> Vec<(usize, f64)> {
        let mut hits: Vec<(usize, f64)> = Vec::new();
        if k == 0 || items.is_empty() {
            return hits;
        }
        let (r0, c0) = self.row_col(crate::refdata::to_e5(p.lat), to_e5(p.lon));
        // Smallest cell side in metres (east–west shrinks with latitude).
        let cell_m = from_e5(self.cell_e5).to_radians()
            * crate::geo::EARTH_RADIUS_M
            * p.lat.to_radians().cos().min(1.0);
        let max_ring = (max_m / cell_m).ceil() as i64 + 1;
        let mut scanned = 0;
        for ring in 0..=max_ring {
            for dr in -ring..=ring {
                for dc in -ring..=ring {
                    if dr.abs() != ring && dc.abs() != ring {
                        continue; // inner cells were searched already
                    }
                    let Some(range) = self.range(r0 + dr, c0 + dc, items.len()) else {
                        continue;
                    };
                    scanned += range.len();
                    for i in range {
                        let d = haversine_m(p, coord(&items[i]));
                        if d <= max_m {
                            hits.push((i, d));
                        }
                    }
                }
            }
            hits.sort_by(|a, b| a.1.total_cmp(&b.1));
            hits.truncate(k);
            // Anything in ring+1 or further is at least `ring * cell_m` away.
            let bound = ring as f64 * cell_m;
            if (hits.len() == k && hits[k - 1].1 <= bound) || scanned == items.len() {
                break;
            }
        }
        hits
    }
}

// ---------------------------------------------------------------- timetable

/// Timetable for one region (AV/LD/MD, or one Cercanías núcleo).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimetableFile {
    pub header: Header,
    pub region: String,
    /// Operator shown to users (e.g. "Renfe", "OUIGO").
    pub operator: String,
    /// Whether live positions exist for this timetable. When false (e.g.
    /// OUIGO, which publishes only its timetable), the engine places trains
    /// by timetable and marks them as such.
    pub live: bool,
    pub stops: Vec<StopRec>,
    pub routes: Vec<RouteRec>,
    pub shapes: Vec<ShapeRec>,
    pub patterns: Vec<PatternRec>,
    /// GTFS service ids referenced by trips (to rebuild trip ids compactly).
    pub services: Vec<String>,
    pub trips: Vec<TripRec>,
}

impl HasHeader for TimetableFile {
    fn header(&self) -> &Header {
        &self.header
    }
}

/// Track sections between consecutive stops (from OpenStreetMap) for one
/// region, shared by every pattern running between those stops. A separate
/// file so the map can show trains before the detailed geometry arrives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeometryFile {
    pub header: Header,
    pub region: String,
    pub legs: Vec<ShapeRec>,
    /// Track facts per leg (same order as `legs`), from OpenStreetMap tags.
    pub info: Vec<LegInfo>,
}

/// Track facts for one leg: the most common value along it (0 = unknown).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct LegInfo {
    /// Track gauge in mm (1668 Iberian, 1435 standard, 1000 metric); 1 = dual gauge.
    pub gauge_mm: u16,
    /// Maximum line speed in km/h.
    pub max_kmh: u16,
}

impl HasHeader for GeometryFile {
    fn header(&self) -> &Header {
        &self.header
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StopRec {
    pub id: String,
    pub name: String,
    pub lat_e5: i32,
    pub lon_e5: i32,
}

impl StopRec {
    pub fn coord(&self) -> LatLon {
        LatLon::new(from_e5(self.lat_e5), from_e5(self.lon_e5))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteRec {
    pub id: String,
    pub short_name: String,
    pub long_name: String,
    /// 0xRRGGBB, if the feed gives one.
    pub color: Option<u32>,
    pub text_color: Option<u32>,
}

/// Track geometry, delta-encoded in 1e-5 degrees: `[lat0, lon0, dlat1, dlon1, ...]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShapeRec {
    pub id: String,
    pub deltas: Vec<i32>,
}

impl ShapeRec {
    pub fn encode(id: String, pts: &[LatLon]) -> Self {
        let mut deltas = Vec::with_capacity(pts.len() * 2);
        let (mut pla, mut plo) = (0, 0);
        for p in pts {
            let (la, lo) = (to_e5(p.lat), to_e5(p.lon));
            deltas.push(la - pla);
            deltas.push(lo - plo);
            (pla, plo) = (la, lo);
        }
        Self { id, deltas }
    }

    pub fn points(&self) -> Vec<LatLon> {
        let (mut la, mut lo) = (0, 0);
        self.deltas
            .chunks_exact(2)
            .map(|d| {
                la += d[0];
                lo += d[1];
                LatLon::new(from_e5(la), from_e5(lo))
            })
            .collect()
    }

    pub fn polyline(&self) -> Polyline {
        Polyline::new(self.points())
    }
}

/// A stop sequence with relative times, shared by many trips.
///
/// Times are seconds after the trip's first arrival, stored as deltas:
/// `run[i]` = arrival at stop i minus departure from stop i-1 (`run[0]` = 0),
/// `dwell[i]` = departure minus arrival at stop i.
/// `dist_m[i]` = metres from stop i-1 to stop i along the shape (or the
/// straight line between stops when there is no shape), `dist_m[0]` = 0.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PatternRec {
    pub stops: Vec<u32>,
    pub run: Vec<u32>,
    pub dwell: Vec<u32>,
    pub dist_m: Vec<u32>,
    /// Index into [`TimetableFile::shapes`]; `None` means straight segments
    /// between stops. `shape_start_m` is where stop 0 sits on that shape.
    pub shape: Option<u32>,
    pub shape_start_m: u32,
    /// When not empty (and `shape` is `None`): one entry per stop-to-stop
    /// section, an index into the region's [`GeometryFile::legs`] or
    /// [`NO_LEG`] for a straight line between the two stops. `dist_m` then
    /// follows the legs.
    pub legs: Vec<u32>,
}

/// Marks a straight section in [`PatternRec::legs`].
pub const NO_LEG: u32 = u32::MAX;

/// Arrival and departure (seconds after trip start) at one stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StopTime {
    pub arrival: u32,
    pub departure: u32,
    /// Cumulative metres from the first stop.
    pub dist_m: u32,
}

impl PatternRec {
    /// Build from absolute (arrival, departure) offsets and cumulative distances.
    pub fn from_absolute(
        stops: Vec<u32>,
        times: &[(u32, u32)],
        cum_dist_m: &[u32],
        shape: Option<u32>,
        shape_start_m: u32,
    ) -> Self {
        let mut run = Vec::with_capacity(times.len());
        let mut dwell = Vec::with_capacity(times.len());
        let mut dist_m = Vec::with_capacity(times.len());
        for (i, &(a, d)) in times.iter().enumerate() {
            let prev_dep = if i == 0 { a } else { times[i - 1].1 };
            run.push(a.saturating_sub(prev_dep));
            dwell.push(d.saturating_sub(a));
            let prev = if i == 0 {
                cum_dist_m[0]
            } else {
                cum_dist_m[i - 1]
            };
            dist_m.push(cum_dist_m[i].saturating_sub(prev));
        }
        Self {
            stops,
            run,
            dwell,
            dist_m,
            shape,
            shape_start_m,
            legs: Vec::new(),
        }
    }

    /// Absolute times and distances for each stop.
    pub fn stop_times(&self) -> Vec<StopTime> {
        let (mut t, mut d) = (0u32, 0u32);
        (0..self.stops.len())
            .map(|i| {
                let arrival = t + self.run[i];
                let departure = arrival + self.dwell[i];
                d += self.dist_m[i];
                t = departure;
                StopTime {
                    arrival,
                    departure,
                    dist_m: d,
                }
            })
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TripRec {
    pub route: u32,
    pub pattern: u32,
    /// Arrival at the first stop, seconds after midnight of the service day
    /// (may exceed 24 h, as in GTFS). Pattern offsets are relative to this.
    pub start: u32,
    /// Bit `n` set = runs on service day `window_start_day + n`.
    pub days: u16,
    /// If set, the GTFS trip id is `services[service] + id_rest`.
    pub service: Option<u32>,
    pub id_rest: String,
    pub headsign: String,
    /// Commercial train number, when the feed gives one separately.
    pub short_name: String,
}

impl TimetableFile {
    /// Full GTFS trip id of a trip.
    pub fn trip_id(&self, t: &TripRec) -> String {
        match t.service {
            Some(s) => format!("{}{}", self.services[s as usize], t.id_rest),
            None => t.id_rest.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{decode, encode};

    fn station(id: &str, lat: f64, lon: f64) -> StationRec {
        StationRec {
            id: id.into(),
            name: id.into(),
            lat_e5: to_e5(lat),
            lon_e5: to_e5(lon),
            services: SERVICE_COMMUTER,
            regions: vec![0],
        }
    }

    fn sample_stations() -> Vec<StationRec> {
        vec![
            station("atocha", 40.4065, -3.6895),
            station("chamartin", 40.4718, -3.6826),
            station("sol", 40.4169, -3.7033),
            station("getafe", 40.3046, -3.7300),
            station("barcelona", 41.3793, 2.1404),
            station("valencia", 39.4664, -0.3772),
        ]
    }

    #[test]
    fn grid_nearest_matches_brute_force() {
        let mut st = sample_stations();
        let grid = GridIndex::build(&mut st, |s| (s.lat_e5, s.lon_e5), 2_000);
        let me = LatLon::new(40.41, -3.70); // near Sol
        let got = grid.nearest(&st, StationRec::coord, me, 3, 50_000.0);
        let names: Vec<_> = got.iter().map(|&(i, _)| st[i].id.as_str()).collect();
        assert_eq!(names, ["sol", "atocha", "chamartin"]);

        let mut brute: Vec<_> = st
            .iter()
            .enumerate()
            .map(|(i, s)| (i, haversine_m(me, s.coord())))
            .collect();
        brute.sort_by(|a, b| a.1.total_cmp(&b.1));
        assert_eq!(got, brute[..3].to_vec());
    }

    #[test]
    fn grid_respects_radius_and_empty_input() {
        let mut st = sample_stations();
        let grid = GridIndex::build(
            &mut st,
            |s| (s.lat_e5, s.lon_e5),
            GridIndex::DEFAULT_CELL_E5,
        );
        let far = grid.nearest(&st, StationRec::coord, LatLon::new(43.0, -8.0), 2, 10_000.0);
        assert!(far.is_empty());
        let all = grid.nearest(&st, StationRec::coord, LatLon::new(40.4, -3.7), 10, 1e7);
        assert_eq!(all.len(), st.len());
        let empty: Vec<StationRec> = vec![];
        assert!(
            grid.nearest(&empty, StationRec::coord, LatLon::new(40.0, -3.0), 1, 1e6)
                .is_empty()
        );
    }

    #[test]
    fn shape_delta_round_trip() {
        let pts = vec![
            LatLon::new(40.40652, -3.68951),
            LatLon::new(40.40700, -3.69000),
            LatLon::new(40.39000, -3.70000),
        ];
        let s = ShapeRec::encode("s".into(), &pts);
        assert_eq!(s.deltas[2], 48); // small deltas → 1–2 byte varints
        for (a, b) in s.points().iter().zip(&pts) {
            assert!((a.lat - b.lat).abs() < 1e-5 && (a.lon - b.lon).abs() < 1e-5);
        }
    }

    #[test]
    fn pattern_times_round_trip() {
        let times = [(0, 0), (600, 660), (1500, 1500)];
        let cum = [0, 8_000, 21_000];
        let p = PatternRec::from_absolute(vec![3, 1, 2], &times, &cum, None, 0);
        assert_eq!(p.run, [0, 600, 840]);
        assert_eq!(p.dwell, [0, 60, 0]);
        let st = p.stop_times();
        assert_eq!(
            st.iter()
                .map(|s| (s.arrival, s.departure))
                .collect::<Vec<_>>(),
            times
        );
        assert_eq!(st.iter().map(|s| s.dist_m).collect::<Vec<_>>(), cum);
    }

    #[test]
    fn files_round_trip_and_check_header() {
        let mut stations = sample_stations();
        let grid = GridIndex::build(&mut stations, |s| (s.lat_e5, s.lon_e5), 10_000);
        let f = StationsFile {
            header: Header::new(20_000, 8, 1_700_000_000),
            regions: vec![RegionRec {
                code: "10".into(),
                name: "Madrid".into(),
                bbox_e5: [0, 0, 1, 1],
            }],
            stations,
            grid,
        };
        let bytes = encode(&f).unwrap();
        assert_eq!(&bytes[..4], &MAGIC);
        assert_eq!(decode_file::<StationsFile>(&bytes).unwrap(), f);

        let mut bad = f.clone();
        bad.header.version = 1;
        assert_eq!(
            decode_file::<StationsFile>(&encode(&bad).unwrap()),
            Err(FormatError::Version(1))
        );

        let tt = TimetableFile {
            header: Header::new(20_000, 8, 0),
            region: "ld".into(),
            operator: "Renfe".into(),
            live: true,
            stops: vec![],
            routes: vec![],
            shapes: vec![],
            patterns: vec![],
            services: vec!["1004D".into()],
            trips: vec![TripRec {
                route: 0,
                pattern: 0,
                start: 8 * 3600,
                days: 0b10,
                service: Some(0),
                id_rest: "19799C1".into(),
                headsign: String::new(),
                short_name: String::new(),
            }],
        };
        let back: TimetableFile = decode(&encode(&tt).unwrap()).unwrap();
        assert_eq!(back.trip_id(&back.trips[0]), "1004D19799C1");
    }
}
